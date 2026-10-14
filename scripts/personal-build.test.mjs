import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = path.resolve('scripts/prepare-personal-build.mjs');
const upstreamScheme = 'com.googleusercontent.apps.123-official';
const clientId = '456-personal.apps.googleusercontent.com';
const scheme = 'com.googleusercontent.apps.456-personal';

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

function prepare(root, id = '') {
  return spawnSync(process.execPath, [script], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GOOGLE_CLIENT_ID: id },
  });
}

test('one preparation aligns both platform callbacks, keeps local settings, and is repeatable', async () => {
  const { root, app, android } = await fixture();
  assert.equal(prepare(root, clientId).status, 0);
  const config = JSON.parse(await readFile(path.join(app, 'src-tauri/tauri.conf.json'), 'utf8'));
  assert.ok(config.plugins['deep-link'].desktop.schemes.includes(scheme));
  assert.ok(config.plugins['deep-link'].mobile.some((entry) => entry.scheme.includes(scheme)));
  assert.equal(config.identifier, 'com.bilingify.readest.personal');
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.equal(config.bundle.windows.nsis.installerHooks, undefined);
  const manifest = await readFile(path.join(android, 'src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.includes(scheme));
  assert.ok(!manifest.includes(upstreamScheme));
  const gradle = await readFile(path.join(android, 'build.gradle.kts'), 'utf8');
  assert.ok(gradle.includes('applicationId = "com.bilingify.readest.personal"'));
  assert.equal(await readFile(path.join(android, 'src/main/java/com/bilingify/readest/personal/MainActivity.kt'), 'utf8'),
    'package com.bilingify.readest.personal\n');
  assert.equal(await readFile(path.join(app, 'src-tauri/gen/android/buildSrc/src/main/java/com/bilingify/readest/personal/kotlin/BuildTask.kt'), 'utf8'),
    'package com.bilingify.readest.personal.kotlin\n');
  const env = await readFile(path.join(app, '.env.local'), 'utf8');
  assert.ok(env.includes('EXISTING_SETTING=keep'));
  assert.ok(env.includes(`NEXT_PUBLIC_GOOGLE_CLIENT_ID=${clientId}`));
  assert.equal(prepare(root, clientId).status, 0);
  assert.equal(await readFile(path.join(app, '.env.local'), 'utf8'), env);
  assert.equal(await readFile(path.join(android, 'build.gradle.kts'), 'utf8'), gradle);
});

test('unconfigured builds remove official callbacks and can receive a client later', async () => {
  const { root, app } = await fixture();
  assert.equal(prepare(root).status, 0);
  const configPath = path.join(app, 'src-tauri/tauri.conf.json');
  assert.ok(!(await readFile(configPath, 'utf8')).includes(upstreamScheme));
  assert.equal(prepare(root, clientId).status, 0);
  assert.ok((await readFile(configPath, 'utf8')).includes(scheme));
});

test('malformed OAuth input fails before changing build files', async () => {
  const { root, app } = await fixture();
  const configPath = path.join(app, 'src-tauri/tauri.conf.json');
  const before = await readFile(configPath, 'utf8');
  assert.notEqual(prepare(root, 'bad\nSECRET=oops').status, 0);
  assert.equal(await readFile(configPath, 'utf8'), before);
});
