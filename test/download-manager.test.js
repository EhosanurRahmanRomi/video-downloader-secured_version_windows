'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DownloadManager, archiveKey } = require('../src/core/download-manager');

class MemoryStore {
  constructor(value = []) { this.value = structuredClone(value); }
  read(fallback) { return this.value === undefined ? fallback : structuredClone(this.value); }
  write(value) { this.value = structuredClone(value); }
}

class FakeEngine extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.stopReason = '';
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
  }
  start() { this.emit('started', { pid: 123 }); return this.promise; }
  complete() { this.resolve({ outcome: 'completed' }); }
  fail(message = 'simulated failure') { this.resolve({ outcome: 'failed', error: message }); }
  stop(reason) { this.stopReason = reason; this.resolve({ outcome: reason === 'cancel' ? 'cancelled' : 'paused' }); }
}

function request(index = 1) {
  return {
    url: `https://example.com/watch?v=${index}`,
    outputDirectory: path.join(os.tmpdir(), 'videoai-test-output'),
    mediaKind: 'video',
    playlistMode: 'single',
    playlistItems: '',
    quality: '1080',
    videoContainer: 'mp4',
    audioFormat: 'mp3',
    embedMetadata: true,
    embedThumbnail: false,
    includeSubtitles: false,
    includeAutoSubtitles: false,
    removeSponsorSegments: false,
    overwrite: false,
    cookiesBrowser: 'none',
    title: `Video ${index}`
  };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness(maxConcurrentDownloads = 2, saved = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-manager-'));
  const engines = [];
  const settings = { maxConcurrentDownloads, retryCount: 3, socketTimeout: 30, fragmentConcurrency: 8, ariaConnections: 8, useAria2: false };
  const manager = new DownloadManager({
    jobsStore: new MemoryStore(saved),
    archiveDirectory: path.join(directory, 'archives'),
    getSettings: () => settings,
    getTools: () => ({ ready: true }),
    runnerFactory: (options) => {
      const engine = new FakeEngine(options);
      engines.push(engine);
      return engine;
    }
  });
  manager.start();
  return { directory, engines, manager, settings };
}

test('enforces simultaneous-video concurrency and starts the next queued job', async (t) => {
  const harness = createHarness(2);
  t.after(() => { harness.manager.shutdown(); fs.rmSync(harness.directory, { recursive: true, force: true }); });
  harness.manager.add(request(1));
  harness.manager.add(request(2));
  harness.manager.add(request(3));
  await tick();

  assert.equal(harness.engines.length, 2);
  assert.equal(harness.manager.getSnapshot().stats.active, 2);
  assert.equal(harness.manager.getSnapshot().stats.queued, 1);

  harness.engines[0].complete();
  await tick();
  await tick();
  assert.equal(harness.engines.length, 3);
  assert.equal(harness.manager.getSnapshot().stats.completed, 1);
});

test('pauses an active job and resumes it through the queue', async (t) => {
  const harness = createHarness(1);
  t.after(() => { harness.manager.shutdown(); fs.rmSync(harness.directory, { recursive: true, force: true }); });
  const job = harness.manager.add(request(4));
  await tick();
  harness.manager.action(job.id, 'pause');
  await tick();
  assert.equal(harness.engines[0].stopReason, 'pause');
  assert.equal(harness.manager.getJob(job.id).status, 'paused');

  harness.manager.action(job.id, 'resume');
  await tick();
  assert.equal(harness.engines.length, 2);
  assert.equal(harness.manager.getJob(job.id).status, 'downloading');
});

test('blocks a duplicate active request but permits a different format', async (t) => {
  const harness = createHarness(1);
  t.after(() => { harness.manager.shutdown(); fs.rmSync(harness.directory, { recursive: true, force: true }); });
  harness.manager.add(request(5));
  assert.throws(() => harness.manager.add(request(5)), /already queued or active/u);
  assert.doesNotThrow(() => harness.manager.add({ ...request(5), mediaKind: 'audio', audioFormat: 'mp3' }));
});

test('isolates archive files across media formats', () => {
  const video = {
    canonicalUrl: 'https://example.com/watch?v=6', outputDirectory: 'D:\\Media', mediaKind: 'video',
    audioFormat: 'mp3', videoContainer: 'mp4', quality: '1080', playlistMode: 'single', playlistItems: ''
  };
  const audio = { ...video, mediaKind: 'audio' };
  assert.notEqual(archiveKey(video), archiveKey(audio));
  assert.equal(archiveKey(video), archiveKey({ ...video }));
});

test('restores interrupted work as paused instead of silently restarting it', () => {
  const saved = [{
    ...request(7), canonicalUrl: request(7).url, id: 'saved', archivePath: 'archive.txt', status: 'downloading',
    progress: 55, logs: [], error: '', speed: 100, eta: 4, createdAt: new Date().toISOString()
  }];
  const harness = createHarness(1, saved);
  try {
    const restored = harness.manager.getJob('saved');
    assert.equal(restored.status, 'paused');
    assert.match(restored.error, /closed before/u);
    assert.equal(harness.engines.length, 0);
  } finally {
    harness.manager.shutdown();
    fs.rmSync(harness.directory, { recursive: true, force: true });
  }
});

test('reports partial playlist progress by selected order instead of source index', async (t) => {
  const harness = createHarness(1);
  t.after(() => { harness.manager.shutdown(); fs.rmSync(harness.directory, { recursive: true, force: true }); });
  const job = harness.manager.add({
    ...request(8),
    url: 'https://example.com/playlist',
    playlistMode: 'playlist',
    selectedPlaylistItems: [80, 100]
  });
  await tick();

  harness.engines[0].emit('item', {
    title: 'Video eighty', playlist_index: 80, playlist_autonumber: 1, playlist_count: 100, n_entries: 2
  });
  harness.engines[0].emit('progress', {
    status: 'downloading', percent: 50, downloadedBytes: 50, totalBytes: 100, speed: 10, eta: 5
  });
  const active = harness.manager.getJob(job.id);
  assert.equal(active.currentPlaylistIndex, 80);
  assert.equal(active.currentItemIndex, 1);
  assert.equal(active.itemCount, 2);
  assert.equal(active.progress, 25);
  assert.match(active.lastMessage, /playlist #80/u);
});
