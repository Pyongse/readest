import fs from 'node:fs';
import path from 'node:path';

const app = path.resolve('apps/readest-app');
const tauriDir = path.join(app, 'src-tauri');
const desktopId = (process.env.GOOGLE_DESKTOP_CLIENT_ID ?? '').trim();
const androidId = (process.env.GOOGLE_ANDROID_CLIENT_ID ?? '').trim();
for (const id of [desktopId, androidId]) {
  if (id && !/^\d+-[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(id)) {
    throw new Error('Google OAuth client IDs must not contain secrets or extra lines.');
  }
}
if (Boolean(desktopId) !== Boolean(androidId) ||
    (desktopId && desktopId.split('-')[0] !== androidId.split('-')[0])) {
  throw new Error('Configure both desktop and Android clients from the same Google Cloud project.');
}

const identifier = 'com.bilingify.readest.personal';
const isGoogleScheme = (scheme) => scheme.startsWith('com.googleusercontent.apps.');
const configPath = path.join(tauriDir, 'tauri.conf.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.productName = 'Readest Personal';
config.identifier = identifier;
config.build.beforeBuildCommand = 'pnpm build && pnpm upload-sourcemaps';
config.bundle.createUpdaterArtifacts = false;
if (config.plugins.updater) config.plugins.updater.endpoints = [];
// The upstream thumbnail extension shares a CLSID with the official installation.
delete config.bundle.windows.nsis.installerHooks;

const deepLink = config.plugins['deep-link'];
deepLink.desktop.schemes = deepLink.desktop.schemes.filter((scheme) => !isGoogleScheme(scheme));
deepLink.mobile = deepLink.mobile
  .map((entry) => ({ ...entry, scheme: entry.scheme.filter((scheme) => !isGoogleScheme(scheme)) }))
  .filter((entry) => entry.scheme.length > 0);
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

const envPath = path.join(app, '.env.local');
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const values = {
  NEXT_PUBLIC_APP_PLATFORM: 'tauri',
  NEXT_PUBLIC_PERSONAL_BUILD: 'true',
  NEXT_PUBLIC_SELF_HOSTED: 'true',
  NEXT_PUBLIC_DISABLE_UPDATER: 'true',
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: '',
  NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID: desktopId,
  NEXT_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: androidId,
};
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
}
fs.writeFileSync(envPath, env.trimStart());

// Desktop keychain entries use a fixed service name, independently of the app ID.
const bridgePath = path.join(tauriDir, 'plugins/tauri-plugin-native-bridge/src/desktop.rs');
const bridge = fs.readFileSync(bridgePath, 'utf8');
if (!bridge.includes('"Readest Safe Storage"') && !bridge.includes('"Readest Personal Safe Storage"')) {
  throw new Error('Upstream keyring storage changed; review personal credential isolation.');
}
fs.writeFileSync(bridgePath, bridge.replace('"Readest Safe Storage"', '"Readest Personal Safe Storage"'));

// Run after Android init and restoring the upstream's committed Android files.
const androidDir = path.join(tauriDir, 'gen/android');
function prepareAndroid(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['build', '.gradle'].includes(entry.name)) {
      prepareAndroid(file);
    } else if (entry.isFile() && /\.(kt|kts|xml|pro|properties)$/.test(entry.name)) {
      const original = fs.readFileSync(file, 'utf8');
      let text = original.replaceAll(identifier, 'com.bilingify.readest')
        .replaceAll('com.bilingify.readest', identifier);
      text = text.replace(/(<string\s+name="app_name"[^>]*>)Readest(<\/string>)/g,
        '$1Readest Personal$2');
      if (entry.name === 'AndroidManifest.xml') {
        text = text.replace('android:label="Readest"', 'android:label="Readest Personal"');
        // Native Android authorization does not use a Google custom URI callback.
        text = text.replace(/com\.googleusercontent\.apps\.[0-9A-Za-z-]+/g,
          'readest-personal-unconfigured');
      }
      if (text !== original) fs.writeFileSync(file, text);
    }
  }
}
if (fs.existsSync(androidDir)) prepareAndroid(androidDir);

// Tauri also validates the physical Java package path, not only the namespace.
function movePackageSources(packageDir) {
  if (!fs.existsSync(packageDir)) return;
  const root = fs.realpathSync(androidDir);
  const source = fs.realpathSync(packageDir);
  const target = path.join(source, 'personal');
  if (!source.startsWith(`${root}${path.sep}`) ||
      (fs.existsSync(target) && !fs.realpathSync(target).startsWith(`${root}${path.sep}`))) {
    throw new Error('Android package paths must remain inside gen/android.');
  }
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (name !== 'personal') fs.renameSync(path.join(source, name), path.join(target, name));
  }
}
for (const sourceRoot of ['app/src/main', 'app/src/test', 'buildSrc/src/main']) {
  movePackageSources(path.join(androidDir, sourceRoot, 'java/com/bilingify/readest'));
}
console.log(`Readest Personal prepared: Google OAuth clients ${desktopId ? 'configured by platform' : 'awaiting configuration'}; custom API translation enabled.`);
