'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
const rendererCode = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'app.js'), 'utf8');

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function successful(data) {
  return Promise.resolve({ ok: true, data });
}

function createRenderer({ inspection } = {}) {
  const { window } = parseHTML(html);
  window.window = window;
  window.globalThis = window;
  window.console = console;
  window.URL = URL;
  window.Intl = Intl;
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.structuredClone = structuredClone;
  for (const dialog of window.document.querySelectorAll('dialog')) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
  }
  for (const select of window.document.querySelectorAll('select')) {
    let selectedValue = select.querySelector('option[selected]')?.getAttribute('value') || select.querySelector('option')?.getAttribute('value') || '';
    Object.defineProperty(select, 'value', {
      configurable: true,
      get: () => selectedValue,
      set: (value) => { selectedValue = String(value); }
    });
  }

  const calls = { added: [], inspected: [], stateListener: null };
  const settings = {
    downloadDirectory: 'D:\\Downloads', maxConcurrentDownloads: 2, fragmentConcurrency: 8,
    ariaConnections: 8, useAria2: true, retryCount: 10, socketTimeout: 30,
    defaultMediaKind: 'video', defaultQuality: '1080', defaultVideoContainer: 'mp4',
    defaultAudioFormat: 'mp3', embedMetadata: true, embedThumbnail: true,
    preventSleep: true, cookiesBrowser: 'none'
  };
  window.videoAI = {
    bootstrap: () => successful({
      version: '2.0.0', platform: 'win32', settings,
      tools: { ready: true, aria2Available: true, versions: { ytDlp: 'test', ffmpeg: 'test', aria2: 'test' } },
      downloads: { jobs: [], stats: { total: 0, active: 0, queued: 0, completed: 0, failed: 0, combinedSpeed: 0 } }
    }),
    chooseFolder: () => successful('D:\\Media'),
    readClipboard: () => successful('https://example.com/video'),
    inspectMedia: (request) => {
      calls.inspected.push(request);
      return successful(inspection || { title: 'Example', isPlaylist: false, duration: 60, thumbnail: '', sourceLabel: 'Creator', entries: [] });
    },
    addDownload: (request) => { calls.added.push(request); return successful({ id: 'job' }); },
    jobAction: () => successful(null), clearFinished: () => successful({ removed: 0 }),
    getJobLog: () => successful({ title: 'Log', error: '', entries: [] }),
    openJobFolder: () => successful(true), showJobFile: () => successful(true),
    updateSettings: (patch) => successful({ ...settings, ...patch }),
    checkTools: () => successful({ ready: true, aria2Available: true, versions: {} }),
    updateYtDlp: () => successful({ message: 'Updated' }),
    onDownloadState: (listener) => { calls.stateListener = listener; return () => {}; }
  };

  vm.runInContext(rendererCode, vm.createContext(window), { filename: 'renderer/app.js' });
  return { window, document: window.document, calls };
}

test('renderer boots against the narrow preload contract and applies defaults', async () => {
  const { document, calls } = createRenderer();
  await nextTurn();
  await nextTurn();
  assert.equal(document.querySelector('#app-version').textContent, 'Version 2.0.0');
  assert.equal(document.querySelector('#output-directory').value, 'D:\\Downloads');
  assert.equal(document.querySelector('#stat-fragments').textContent, '8×');
  assert.match(document.querySelector('#engine-status-text').textContent, /ready/u);
  assert.equal(typeof calls.stateListener, 'function');
});

test('renderer switches views and builds a complete download request', async () => {
  const { window, document, calls } = createRenderer();
  await nextTurn();
  await nextTurn();

  document.querySelector('[data-view="queue"]').dispatchEvent(new window.Event('click'));
  assert.equal(document.querySelector('#view-queue').classList.contains('active'), true);
  document.querySelector('[data-view="new"]').dispatchEvent(new window.Event('click'));

  document.querySelector('#media-url').value = 'https://example.com/video';
  document.querySelector('input[name="media-kind"][value="video"]').removeAttribute('checked');
  document.querySelector('input[name="media-kind"][value="audio"]').setAttribute('checked', '');
  document.querySelector('input[name="media-kind"][value="audio"]').dispatchEvent(new window.Event('change'));
  document.querySelector('#audio-format').value = 'flac';
  document.querySelector('#download-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await nextTurn();
  await nextTurn();

  assert.equal(calls.added.length, 1);
  assert.equal(calls.added[0].url, 'https://example.com/video');
  assert.equal(calls.added[0].mediaKind, 'audio');
  assert.equal(calls.added[0].audioFormat, 'flac');
  assert.equal(calls.added[0].outputDirectory, 'D:\\Downloads');
  assert.equal(document.querySelector('#media-url').value, '');
});

test('renderer references existing element IDs and keeps a restrictive CSP', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]));
  const referenced = [...rendererCode.matchAll(/\$\('#([^']+)'\)/gu)].map((match) => match[1]);
  const missing = [...new Set(referenced)].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/u)?.[1] || '';
  assert.match(csp, /default-src 'self'/u);
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/u);
  assert.match(csp, /object-src 'none'/u);
});

test('renderer shows every playlist video and sends only checked items', async () => {
  const inspection = {
    title: 'Four videos', sourceLabel: 'Creator', thumbnail: '', isPlaylist: true,
    playlistCount: 4, listedCount: 4, selectableCount: 3, unavailableCount: 1,
    entries: [
      { index: 1, title: 'Introduction', sourceLabel: 'Creator', duration: 60, thumbnail: '', availability: 'public', selectable: true },
      { index: 2, title: 'Advanced lesson', sourceLabel: 'Creator', duration: 120, thumbnail: '', availability: 'public', selectable: true },
      { index: 3, title: 'Final lesson', sourceLabel: 'Guest', duration: 180, thumbnail: '', availability: 'unlisted', selectable: true },
      { index: 4, title: 'Unavailable video', sourceLabel: '', duration: 0, thumbnail: '', availability: 'unavailable', selectable: false }
    ]
  };
  const { window, document, calls } = createRenderer({ inspection });
  await nextTurn();
  await nextTurn();

  document.querySelector('#media-url').value = 'https://example.com/playlist';
  document.querySelector('#analyze-button').dispatchEvent(new window.Event('click'));
  await nextTurn();
  await nextTurn();

  assert.equal(document.querySelector('#playlist-browser').classList.contains('hidden'), false);
  assert.equal(document.querySelectorAll('.playlist-item').length, 4);
  assert.equal(document.querySelector('#playlist-total').textContent, '4');
  assert.equal(document.querySelector('#playlist-selected').textContent, '3');
  assert.equal(document.querySelector('#playlist-duration').textContent, '6:00');

  const second = document.querySelector('[data-playlist-index="2"]');
  second.checked = false;
  second.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('#playlist-selected').textContent, '2');

  document.querySelector('#playlist-search').value = 'final';
  document.querySelector('#playlist-search').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelectorAll('.playlist-item').length, 1);
  assert.match(document.querySelector('.playlist-item-title').textContent, /Final lesson/u);

  document.querySelector('#download-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await nextTurn();
  await nextTurn();
  assert.equal(calls.added.length, 1);
  assert.deepEqual(Array.from(calls.added[0].selectedPlaylistItems), [1, 3]);
  assert.equal(calls.added[0].playlistMode, 'playlist');
});

test('renderer incrementally displays large playlists without losing selections', async () => {
  const entries = Array.from({ length: 135 }, (_, offset) => ({
    index: offset + 1, title: `Video ${offset + 1}`, sourceLabel: 'Creator', duration: 30,
    thumbnail: '', availability: 'public', selectable: true
  }));
  const { window, document } = createRenderer({ inspection: {
    title: 'Large playlist', sourceLabel: 'Creator', thumbnail: '', isPlaylist: true,
    playlistCount: 135, entries
  } });
  await nextTurn();
  await nextTurn();
  document.querySelector('#media-url').value = 'https://example.com/large-playlist';
  document.querySelector('#analyze-button').dispatchEvent(new window.Event('click'));
  await nextTurn();
  await nextTurn();

  assert.equal(document.querySelectorAll('.playlist-item').length, 100);
  document.querySelector('#playlist-load-more').dispatchEvent(new window.Event('click'));
  assert.equal(document.querySelectorAll('.playlist-item').length, 135);
  assert.equal(document.querySelector('#playlist-selected').textContent, '135');
});
