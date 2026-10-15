import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = path.resolve('scripts/prepare-personal-build.mjs');
const upstreamScheme = 'com.googleusercontent.apps.123-official';
const desktopId = '456-desktop.apps.googleusercontent.com';
const androidId = '456-android.apps.googleusercontent.com';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'readest-personal-'));
  const app = path.join(root, 'apps/readest-app');
  const android = path.join(app, 'src-tauri/gen/android/app');
  await mkdir(path.join(android, 'src/main'), { recursive: true });
  const bridgeDir = path.join(app, 'src-tauri/plugins/tauri-plugin-native-bridge/src');
  await mkdir(bridgeDir, { recursive: true });
  await writeFile(path.join(bridgeDir, 'desktop.rs'), 'const KEYRING_SERVICE: &str = "Readest Safe Storage";\n');
  const javaDir = path.join(android, 'src/main/java/com/bilingify/readest');
  const buildSrcDir = path.join(app, 'src-tauri/gen/android/buildSrc/src/main/java/com/bilingify/readest/kotlin');
  await mkdir(javaDir, { recursive: true });
  await mkdir(buildSrcDir, { recursive: true });
  await writeFile(path.join(javaDir, 'MainActivity.kt'), 'package com.bilingify.readest\n');
  await writeFile(path.join(buildSrcDir, 'BuildTask.kt'), 'package com.bilingify.readest.kotlin\n');
  await writeFile(path.join(app, '.env.local'), 'EXISTING_SETTING=keep\n');
  await writeFile(path.join(app, 'src-tauri/tauri.conf.json'), JSON.stringify({
    productName: 'Readest', identifier: 'com.bilingify.readest',
    build: { beforeBuildCommand: 'pnpm build && pnpm upload-sourcemaps' },
    bundle: { createUpdaterArtifacts: true, windows: { nsis: { installerHooks: 'hooks.nsh' } } },
    plugins: { 'deep-link': {
      desktop: { schemes: ['readest', upstreamScheme] },
      mobile: [{ scheme: [upstreamScheme], appLink: false }],
    } },
  }));
  await writeFile(path.join(android, 'build.gradle.kts'), 'namespace = "com.bilingify.readest"\napplicationId = "com.bilingify.readest"\n');
  await writeFile(path.join(android, 'src/main/AndroidManifest.xml'), `<manifest><application android:label="Readest"><data android:scheme="${upstreamScheme}" /></application></manifest>`);
  return { root, app, android };
}

function prepare(root, desktop = '', android = '', desktopSecret = '') {
  return spawnSync(process.execPath, [script], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GOOGLE_DESKTOP_CLIENT_ID: desktop, GOOGLE_ANDROID_CLIENT_ID: android, GOOGLE_DESKTOP_CLIENT_SECRET: desktopSecret },
  });
}

test('preparation separates platform clients without Google custom callbacks and is repeatable', async () => {
  const { root, app, android } = await fixture();
  assert.equal(prepare(root, desktopId, androidId).status, 0);
  const config = JSON.parse(await readFile(path.join(app, 'src-tauri/tauri.conf.json'), 'utf8'));
  assert.ok(!JSON.stringify(config.plugins['deep-link']).includes('com.googleusercontent.apps.'));
  assert.equal(config.identifier, 'com.bilingify.readest.personal');
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.equal(config.bundle.windows.nsis.installerHooks, undefined);
  const manifest = await readFile(path.join(android, 'src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.includes('readest-personal-unconfigured'));
  assert.ok(!manifest.includes(upstreamScheme));
  const gradle = await readFile(path.join(android, 'build.gradle.kts'), 'utf8');
  assert.ok(gradle.includes('applicationId = "com.bilingify.readest.personal"'));
  assert.equal(await readFile(path.join(android, 'src/main/java/com/bilingify/readest/personal/MainActivity.kt'), 'utf8'),
    'package com.bilingify.readest.personal\n');
  assert.equal(await readFile(path.join(app, 'src-tauri/gen/android/buildSrc/src/main/java/com/bilingify/readest/personal/kotlin/BuildTask.kt'), 'utf8'),
    'package com.bilingify.readest.personal.kotlin\n');
  const env = await readFile(path.join(app, '.env.local'), 'utf8');
  assert.ok(env.includes('EXISTING_SETTING=keep'));
  assert.ok(env.includes(`NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID=${desktopId}`));
  assert.ok(env.includes(`NEXT_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=${androidId}`));
  assert.equal(prepare(root, desktopId, androidId).status, 0);
  assert.equal(await readFile(path.join(app, '.env.local'), 'utf8'), env);
  assert.equal(await readFile(path.join(android, 'build.gradle.kts'), 'utf8'), gradle);
});

test('unconfigured builds remove official callbacks and can receive a client later', async () => {
  const { root, app } = await fixture();
  assert.equal(prepare(root).status, 0);
  const configPath = path.join(app, 'src-tauri/tauri.conf.json');
  assert.ok(!(await readFile(configPath, 'utf8')).includes(upstreamScheme));
  assert.equal(prepare(root, desktopId, androidId).status, 0);
  assert.ok(!(await readFile(configPath, 'utf8')).includes('com.googleusercontent.apps.'));
});

test('malformed OAuth input fails before changing build files', async () => {
  const { root, app } = await fixture();
  const configPath = path.join(app, 'src-tauri/tauri.conf.json');
  const before = await readFile(configPath, 'utf8');
  assert.notEqual(prepare(root, 'bad\nSECRET=oops', androidId).status, 0);
  assert.equal(await readFile(configPath, 'utf8'), before);
});

test('partial configuration or clients from different Cloud projects fail before modifying files', async () => {
  const { root, app } = await fixture();
  const configPath = path.join(app, 'src-tauri/tauri.conf.json');
  const before = await readFile(configPath, 'utf8');
  assert.notEqual(prepare(root, desktopId).status, 0);
  assert.notEqual(prepare(root, desktopId, '789-android.apps.googleusercontent.com').status, 0);
  assert.equal(await readFile(configPath, 'utf8'), before);
});

test('desktop credentials stay in the local env file and reject multiline input', async () => {
  const { root, app } = await fixture();
  assert.equal(prepare(root, desktopId, androidId, 'test-desktop-credential').status, 0);
  const env = await readFile(path.join(app, '.env.local'), 'utf8');
  assert.ok(env.includes('NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_SECRET="test-desktop-credential"'));
  const configPath = path.join(app, 'src-tauri/tauri.conf.json');
  const before = await readFile(configPath, 'utf8');
  assert.ok(!before.includes('test-desktop-credential'));
  assert.notEqual(prepare(root, desktopId, androidId, 'bad\nEXTRA=value').status, 0);
  assert.equal(await readFile(configPath, 'utf8'), before);
});
