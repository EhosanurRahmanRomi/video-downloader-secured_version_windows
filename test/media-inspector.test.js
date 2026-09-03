'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectionFromData, sanitizePlaylistEntry } = require('../src/core/media-inspector');

test('keeps every playlist entry and exposes useful selection metadata', () => {
  const entries = Array.from({ length: 106 }, (_, offset) => ({
    id: `video-${offset + 1}`,
    title: `Video ${offset + 1}`,
    playlist_index: offset + 1,
    duration: 60 + offset,
    channel: 'Example creator',
    thumbnail: `https://img.example/${offset + 1}.jpg`,
    availability: 'public'
  }));
  const result = inspectionFromData({
    _type: 'playlist',
    title: 'Complete playlist',
    playlist_count: 106,
    entries
  }, 'https://example.com/playlist');

  assert.equal(result.isPlaylist, true);
  assert.equal(result.playlistCount, 106);
  assert.equal(result.listedCount, 106);
  assert.equal(result.selectableCount, 106);
  assert.equal(result.entries.length, 106);
  assert.equal(result.entries.at(-1).index, 106);
  assert.equal(result.totalDuration, entries.reduce((total, entry) => total + entry.duration, 0));
});

test('preserves unavailable positions and sanitizes unsafe playlist fields', () => {
  const missing = sanitizePlaylistEntry(null, 4);
  assert.deepEqual(missing, {
    index: 5, id: '', title: 'Unavailable video', sourceLabel: '', thumbnail: '',
    duration: 0, availability: 'unavailable', selectable: false
  });

  const entry = sanitizePlaylistEntry({
    id: 'x', title: '[Deleted video]', playlist_index: 9,
    thumbnail: 'file:///private.png', duration: -10, channel: 'Creator'
  }, 0);
  assert.equal(entry.index, 9);
  assert.equal(entry.thumbnail, '');
  assert.equal(entry.duration, 0);
  assert.equal(entry.selectable, false);
});
