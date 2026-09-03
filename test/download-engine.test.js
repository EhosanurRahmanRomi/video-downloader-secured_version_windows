'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { DownloadEngine, classifyFailure } = require('../src/core/download-engine');

function job() {
  return {
    url: 'https://example.com/video', outputDirectory: '.', archivePath: './archive.txt',
    mediaKind: 'video', quality: '720', videoContainer: 'mp4', audioFormat: 'mp3',
    playlistMode: 'single', playlistItems: '', overwrite: false, embedMetadata: false,
    embedThumbnail: false, includeSubtitles: false, includeAutoSubtitles: false,
    removeSponsorSegments: false, cookiesBrowser: 'none'
  };
}

function settings() {
  return { retryCount: 3, socketTimeout: 30, fragmentConcurrency: 8, useAria2: false, ariaConnections: 8 };
}

function childProcessDouble() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 456;
  child.kill = () => { child.emit('close', null, 'SIGTERM'); return true; };
  return child;
}

test('streams structured progress, item, filepath, and redacted log events', async () => {
  const child = childProcessDouble();
  const engine = new DownloadEngine({
    job: job(), settings: settings(), tools: { ready: true, ytDlpPath: 'yt-dlp.exe' },
    spawnImpl: () => child
  });
  const events = [];
  for (const name of ['started', 'progress', 'item', 'file', 'log']) engine.on(name, (event) => events.push([name, event]));
  const completion = engine.start();
  child.stdout.write('__VAI_ITEM__{"id":"x","title":"Test","playlist_index":1,"playlist_count":1}\n');
  child.stdout.write('__VAI_PROGRESS__{"status":"downloading","_percent_str":"25%","downloaded_bytes":25,"total_bytes":100}\n');
  child.stdout.write('__VAI_FILE__"D:\\\\Test.mp4"\n');
  child.stderr.write('GET https://cdn.example/file?token=secret\n');
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('close', 0, null);
  assert.deepEqual(await completion, { outcome: 'completed' });
  assert.equal(events.find(([name]) => name === 'progress')[1].percent, 25);
  assert.equal(events.find(([name]) => name === 'item')[1].title, 'Test');
  assert.equal(events.find(([name]) => name === 'file')[1].path, 'D:\\Test.mp4');
  assert.match(events.find(([name]) => name === 'log')[1].message, /\[query hidden\]/u);
});

test('pause settles as paused instead of a process failure', async () => {
  const child = childProcessDouble();
  const engine = new DownloadEngine({
    job: job(), settings: settings(), tools: { ready: true, ytDlpPath: 'yt-dlp.exe' },
    spawnImpl: () => child
  });
  const completion = engine.start();
  engine.stop('pause');
  assert.deepEqual(await completion, { outcome: 'paused' });
});

test('turns common yt-dlp failures into useful messages', () => {
  assert.match(classifyFailure(['ERROR: HTTP Error 429: Too Many Requests'], 1), /rate-limiting/u);
  assert.match(classifyFailure(['ERROR: This video is private. Sign in'], 1), /browser cookie/u);
  assert.match(classifyFailure(['ERROR: This video is DRM protected'], 1), /DRM-protected/u);
  assert.match(classifyFailure(['No space left on device'], 1), /free space/u);
});
