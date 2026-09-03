'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOutputLine, redactLogLine, stripAnsi } = require('../src/core/progress-parser');

test('parses structured yt-dlp progress output', () => {
  const event = parseOutputLine('__VAI_PROGRESS__{"status":"downloading","downloaded_bytes":500,"total_bytes":1000,"speed":250,"eta":2,"_percent_str":" 50.0%","_speed_str":"250 B/s","_eta_str":"00:02"}');
  assert.deepEqual(event, {
    type: 'progress', status: 'downloading', percent: 50, downloadedBytes: 500,
    totalBytes: 1000, speed: 250, eta: 2, speedText: '250 B/s', etaText: '00:02'
  });
});

test('parses item and final filepath sentinels', () => {
  assert.deepEqual(
    parseOutputLine('__VAI_ITEM__{"id":"x","title":"Example","playlist_index":2,"playlist_count":7}'),
    { type: 'item', id: 'x', title: 'Example', playlist_index: 2, playlist_count: 7 }
  );
  assert.deepEqual(parseOutputLine('__VAI_FILE__"D:\\\\Media\\\\Example.mp4"'), { type: 'file', path: 'D:\\Media\\Example.mp4' });
});

test('falls back to standard progress lines and strips ANSI control sequences', () => {
  const event = parseOutputLine('\u001b[0;32m[download]  42.5% of 10.00MiB at 1.00MiB/s ETA 00:06\u001b[0m');
  assert.equal(event.type, 'progress');
  assert.equal(event.percent, 42.5);
  assert.equal(stripAnsi('\u001b[31merror\u001b[0m'), 'error');
});

test('redacts signed query strings and common credential fields from logs', () => {
  const redacted = redactLogLine('GET https://cdn.example.com/file.mp4?token=secret&signature=abc password=hunter2');
  assert.equal(redacted, 'GET https://cdn.example.com/file.mp4?[query hidden] password=[hidden]');
});
