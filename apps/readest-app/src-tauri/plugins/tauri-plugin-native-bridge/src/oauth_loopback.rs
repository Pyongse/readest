use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug)]
pub struct LoopbackSession {
    pub id: String,
    pub redirect_uri: String,
}

struct PendingSession {
    cancelled: Arc<AtomicBool>,
    completed: Arc<AtomicBool>,
    receiver: Option<mpsc::Receiver<Result<String, String>>>,
}

fn sessions() -> &'static Mutex<HashMap<String, PendingSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, PendingSession>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn start(state: &str) -> Result<LoopbackSession, String> {
    start_with_timeout(state, Duration::from_secs(15 * 60))
}

fn start_with_timeout(state: &str, timeout: Duration) -> Result<LoopbackSession, String> {
    // The caller supplies a fresh cryptographic UUID or base64url nonce.
    if !(16..=256).contains(&state.len())
        || !state
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Invalid OAuth state".into());
    }
    let mut pending = sessions().lock().map_err(|_| "OAuth session unavailable")?;
    pending.retain(|_, session| !session.completed.load(Ordering::Acquire));
    if !pending.is_empty() {
        return Err("A Google authorization is already in progress".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|err| err.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let address = listener.local_addr().map_err(|err| err.to_string())?;
    let session = LoopbackSession {
        id: state.to_owned(),
        redirect_uri: format!("http://{address}/oauthredirect"),
    };
    let cancelled = Arc::new(AtomicBool::new(false));
    let completed = Arc::new(AtomicBool::new(false));
    let (sender, receiver) = mpsc::channel();
    pending.insert(
        session.id.clone(),
        PendingSession {
            cancelled: cancelled.clone(),
            completed: completed.clone(),
            receiver: Some(receiver),
        },
    );
    drop(pending);

    let id = session.id.clone();
    let worker_cancelled = cancelled.clone();
    let spawned = thread::Builder::new()
        .name("google-drive-oauth".into())
        .spawn(move || {
            let result = receive_redirect(listener, &id, &worker_cancelled, timeout);
            let failed = result.is_err();
            let _ = sender.send(result);
            completed.store(true, Ordering::Release);
            if failed {
                remove_session(&id, &worker_cancelled);
            }
        });
    if let Err(err) = spawned {
        remove_session(&session.id, &cancelled);
        return Err(err.to_string());
    }
    Ok(session)
}

pub fn await_redirect(id: &str) -> Result<String, String> {
    let (receiver, cancelled) = {
        let mut pending = sessions().lock().map_err(|_| "OAuth session unavailable")?;
        let session = pending
            .get_mut(id)
            .ok_or("OAuth session cancelled or expired")?;
        let receiver = session
            .receiver
            .take()
            .ok_or("OAuth session is already being awaited")?;
        (receiver, session.cancelled.clone())
    };
    let result = receiver
        .recv()
        .unwrap_or_else(|_| Err("OAuth callback receiver stopped".into()));
    remove_session(id, &cancelled);
    result
}

pub fn cancel(id: &str) -> Result<(), String> {
    if let Some(session) = sessions()
        .lock()
        .map_err(|_| "OAuth session unavailable")?
        .remove(id)
    {
        session.cancelled.store(true, Ordering::Release);
    }
    Ok(())
}

fn remove_session(id: &str, cancelled: &Arc<AtomicBool>) {
    if let Ok(mut pending) = sessions().lock() {
        if pending
            .get(id)
            .is_some_and(|session| Arc::ptr_eq(&session.cancelled, cancelled))
        {
            pending.remove(id);
        }
    }
}

fn receive_redirect(
    listener: TcpListener,
    state: &str,
    cancelled: &AtomicBool,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let address = listener.local_addr().map_err(|err| err.to_string())?;
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("Google authorization cancelled".into());
        }
        if Instant::now() >= deadline {
            return Err("Google authorization timed out".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let target = read_target(&mut stream, cancelled, deadline);
                if let Some(target) = target.filter(|target| valid_callback(target, state)) {
                    respond(&mut stream, true);
                    return Ok(format!("http://{address}{target}"));
                }
                respond(&mut stream, false);
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn read_target(
    stream: &mut TcpStream,
    cancelled: &AtomicBool,
    session_deadline: Instant,
) -> Option<String> {
    stream.set_nonblocking(true).ok()?;
    let deadline = session_deadline.min(Instant::now() + Duration::from_secs(2));
    let mut request = Vec::new();
    let mut buffer = [0; 512];
    while request.len() < 8192 {
        if cancelled.load(Ordering::Acquire) || Instant::now() >= deadline {
            return None;
        }
        match stream.read(&mut buffer) {
            Ok(0) => return None,
            Ok(size) => {
                if request.len() + size > 8192 {
                    return None;
                }
                request.extend_from_slice(&buffer[..size]);
                if request.windows(4).any(|part| part == b"\r\n\r\n") {
                    let text = std::str::from_utf8(&request).ok()?;
                    let mut parts = text.lines().next()?.split_ascii_whitespace();
                    let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
                    if method == "GET"
                        && matches!(version, "HTTP/1.1" | "HTTP/1.0")
                        && parts.next().is_none()
                        && target.is_ascii()
                        && !target.contains('#')
                    {
                        return Some(target.to_owned());
                    }
                    return None;
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return None,
        }
    }
    None
}

fn valid_callback(target: &str, state: &str) -> bool {
    let Some(("/oauthredirect", query)) = target.split_once('?') else {
        return false;
    };
    let (mut states, mut results) = (0, 0);
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            return false;
        };
        // Google sends plain parameter names; encoded names could hide duplicates.
        if key.contains('%') {
            return false;
        }
        if key == "state" {
            if value != state {
                return false;
            }
            states += 1;
        } else if matches!(key, "code" | "error") {
            if value.is_empty() {
                return false;
            }
            results += 1;
        }
    }
    states == 1 && results == 1
}

fn respond(stream: &mut TcpStream, accepted: bool) {
    let (status, body) = if accepted {
        (
            "200 OK",
            "Authorization request completed. You can return to Readest Personal.",
        )
    } else {
        ("400 Bad Request", "Invalid authorization callback.")
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_LOCK: Mutex<()> = Mutex::new(());
    const STATE: &str = "473d376e-8334-45ae-b99f-1614ba7c4e21";

    fn send(session: &LoopbackSession, target: &str) -> String {
        send_with_method(session, target, "GET")
    }

    fn send_with_method(session: &LoopbackSession, target: &str, method: &str) -> String {
        let address = session
            .redirect_uri
            .strip_prefix("http://")
            .unwrap()
            .split('/')
            .next()
            .unwrap();
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        write!(
            socket,
            "{method} {target} HTTP/1.1\r\nHost: {address}\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        if let Err(error) = socket.read_to_string(&mut response) {
            // Closing an oversized unread request may reset the TCP connection.
            assert!(
                error.kind() == std::io::ErrorKind::ConnectionReset
                    && response.starts_with("HTTP/1.1 400"),
                "Unexpected callback response error: {error}"
            );
        }
        response
    }

    #[test]
    fn returns_matching_callback_and_cleans_up() {
        let _guard = TEST_LOCK.lock().unwrap();
        let session = start(STATE).unwrap();
        assert!(session.redirect_uri.starts_with("http://127.0.0.1:"));
        let response = send(
            &session,
            &format!("/oauthredirect?code=a%2Fb&state={STATE}"),
        );
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(!response.contains("a%2Fb"));
        assert_eq!(
            await_redirect(&session.id).unwrap(),
            format!("{}?code=a%2Fb&state={STATE}", session.redirect_uri)
        );
        assert!(await_redirect(&session.id).is_err());
        let address = session.redirect_uri[7..].split('/').next().unwrap();
        assert!(TcpStream::connect(address).is_err());
        cancel(&session.id).unwrap();
    }

    #[test]
    fn rejects_wrong_path_state_and_duplicate_state_without_ending_session() {
        let _guard = TEST_LOCK.lock().unwrap();
        let session = start(STATE).unwrap();
        for target in [
            format!("/other?code=value&state={STATE}"),
            "/oauthredirect?code=value&state=wrong".to_string(),
            format!("/oauthredirect?code=value&state={STATE}&state={STATE}"),
            format!("/oauthredirect?state={STATE}"),
            format!("/oauthredirect?code=one&code=two&state={STATE}"),
            format!("/oauthredirect?code=value&error=access_denied&state={STATE}"),
            format!("/oauthredirect?code=value&state={STATE}&%73tate={STATE}"),
        ] {
            assert!(send(&session, &target).starts_with("HTTP/1.1 400"));
        }
        assert!(send_with_method(
            &session,
            &format!("/oauthredirect?code=correct&state={STATE}"),
            "POST"
        )
        .starts_with("HTTP/1.1 400"));
        send(
            &session,
            &format!("/oauthredirect?code=correct&state={STATE}"),
        );
        assert!(await_redirect(&session.id)
            .unwrap()
            .contains("code=correct"));
    }

    #[test]
    fn returns_provider_denial() {
        let _guard = TEST_LOCK.lock().unwrap();
        let session = start(STATE).unwrap();
        send(
            &session,
            &format!("/oauthredirect?error=access_denied&state={STATE}"),
        );
        assert!(await_redirect(&session.id)
            .unwrap()
            .contains("error=access_denied"));
    }

    #[test]
    fn cancels_while_client_has_not_sent_headers() {
        let _guard = TEST_LOCK.lock().unwrap();
        let session = start(STATE).unwrap();
        let address = session.redirect_uri[7..].split('/').next().unwrap();
        let _socket = TcpStream::connect(address).unwrap();
        let id = session.id.clone();
        let waiter = thread::spawn(move || await_redirect(&id));
        thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        cancel(&session.id).unwrap();
        assert!(waiter.join().unwrap().unwrap_err().contains("cancelled"));
        assert!(started.elapsed() < Duration::from_millis(250));
        cancel(&session.id).unwrap();
    }

    #[test]
    fn times_out_and_allows_another_session() {
        let _guard = TEST_LOCK.lock().unwrap();
        let session = start_with_timeout(STATE, Duration::from_millis(50)).unwrap();
        let error = await_redirect(&session.id).unwrap_err();
        assert!(error.contains("timed out"));
        let next = start(STATE).unwrap();
        cancel(&next.id).unwrap();
    }

    #[test]
    fn expires_without_waiting_and_closes_the_listener() {
        let _guard = TEST_LOCK.lock().unwrap();
        let session = start_with_timeout(STATE, Duration::from_millis(50)).unwrap();
        thread::sleep(Duration::from_millis(100));
        let address = session.redirect_uri[7..].split('/').next().unwrap();
        assert!(TcpStream::connect(address).is_err());
        assert!(await_redirect(&session.id).is_err());
        let next = start(STATE).unwrap();
        cancel(&next.id).unwrap();
    }

    #[test]
    fn delivers_a_callback_to_only_one_waiter() {
        let _guard = TEST_LOCK.lock().unwrap();
        let session = start(STATE).unwrap();
        let first_id = session.id.clone();
        let second_id = session.id.clone();
        let first = thread::spawn(move || await_redirect(&first_id));
        let second = thread::spawn(move || await_redirect(&second_id));
        send(
            &session,
            &format!("/oauthredirect?code=value&state={STATE}"),
        );
        let results = [first.join().unwrap(), second.join().unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    }

    #[test]
    fn rejects_oversized_requests_and_keeps_waiting() {
        let _guard = TEST_LOCK.lock().unwrap();
        let session = start(STATE).unwrap();
        let target = format!("/oauthredirect?padding={}&state={STATE}", "x".repeat(9000));
        assert!(send(&session, &target).starts_with("HTTP/1.1 400"));
        send(
            &session,
            &format!("/oauthredirect?code=value&state={STATE}"),
        );
        assert!(await_redirect(&session.id).is_ok());
    }

    #[test]
    fn allows_only_one_active_session_and_validates_state() {
        let _guard = TEST_LOCK.lock().unwrap();
        for state in ["", "short", "a-long-state-containing&query"] {
            assert!(start(state).is_err());
        }
        let session = start(STATE).unwrap();
        assert!(start("1b73a5b3-ef23-4ef6-a8bb-9d869790c099").is_err());
        cancel(&session.id).unwrap();
        assert!(await_redirect(&session.id).is_err());
    }
}
