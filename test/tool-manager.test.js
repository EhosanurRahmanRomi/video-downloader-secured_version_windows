'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolManager, compareVersions } = require('../src/core/tool-manager');

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-tools-'));
  const bundled = path.join(root, 'bundled');
  const userData = path.join(root, 'data');
  fs.mkdirSync(bundled, { recursive: true });
  const contents = {
    'yt-dlp.exe': Buffer.from('MZ clean yt-dlp fixture'),
    'ffmpeg.exe': Buffer.from('MZ clean ffmpeg fixture'),
    'ffprobe.exe': Buffer.from('MZ clean ffprobe fixture'),
    'avcodec.dll': Buffer.from('MZ clean DLL fixture')
  };
  const files = {};
  for (const [name, bytes] of Object.entries(contents)) {
    fs.writeFileSync(path.join(bundled, name), bytes);
    files[name] = { sha256: hash(bytes), size: bytes.length, required: true };
  }
  fs.writeFileSync(path.join(bundled, 'tools-manifest.json'), JSON.stringify({
    schemaVersion: 1, appVersion: 'test', ytDlpVersion: 'test', ffmpegVersion: 'test', files
  }));
  return { root, bundled, userData };
}

test('verifies every required toolchain file and seeds a writable yt-dlp copy', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const manager = new ToolManager({ bundledDirectory: data.bundled, userDataDirectory: data.userData, platform: 'linux' });
  const status = manager.initialize();
  assert.equal(status.ready, true);
  assert.equal(status.aria2Available, false);
  assert.equal(fs.readFileSync(status.ytDlpPath, 'utf8'), 'MZ clean yt-dlp fixture');
  assert.deepEqual(manager.publicStatus().versions, { ytDlp: 'test', ffmpeg: 'test', aria2: '' });
});

test('refuses to start when a required DLL has a size or hash mismatch', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.appendFileSync(path.join(data.bundled, 'avcodec.dll'), 'tampered');
  const manager = new ToolManager({ bundledDirectory: data.bundled, userDataDirectory: data.userData, platform: 'linux' });
  const status = manager.initialize();
  assert.equal(status.ready, false);
  assert.match(status.error, /avcodec\.dll/u);
  assert.equal(status.ytDlpPath, '');
});

test('returns a clear reinstall error when the manifest is absent', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.rmSync(path.join(data.bundled, 'tools-manifest.json'));
  const manager = new ToolManager({ bundledDirectory: data.bundled, userDataDirectory: data.userData, platform: 'linux' });
  const status = manager.initialize();
  assert.equal(status.ready, false);
  assert.match(status.error, /manifest/u);
});

test('compares dated yt-dlp versions numerically', () => {
  assert.equal(compareVersions('2026.08.19', '2026.7.31'), 1);
  assert.equal(compareVersions('2026.08.19', '2026.08.19'), 0);
  assert.equal(compareVersions('2025.12.01', '2026.01.01'), -1);
});
