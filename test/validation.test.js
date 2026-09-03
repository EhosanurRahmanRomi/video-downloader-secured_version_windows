'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  normalizeHttpUrl,
  canonicalizeUrl,
  validatePlaylistItems,
  compactPlaylistIndices,
  validateDownloadRequest,
  sanitizeSettings
} = require('../src/core/validation');

test('accepts public HTTP(S) media URLs and canonicalizes tracking parameters', () => {
  assert.equal(normalizeHttpUrl(' https://www.youtube.com/watch?v=abc&list=xyz '), 'https://www.youtube.com/watch?v=abc&list=xyz');
  assert.equal(
    canonicalizeUrl('https://example.com/watch?v=42&utm_source=test&si=share#chapter'),
    'https://example.com/watch?v=42'
  );
});

test('rejects local, script, credential-bearing, and malformed URLs', () => {
  for (const value of [
    'file:///C:/secret.txt',
    'javascript:alert(1)',
    'https://user:pass@example.com/video',
    'not a url',
    'https://example.com/\n--exec'
  ]) {
    assert.throws(() => normalizeHttpUrl(value));
  }
});

test('validates yt-dlp playlist item expressions', () => {
  assert.equal(validatePlaylistItems(' 1-10, 15, 20:30:2 '), '1-10,15,20:30:2');
  assert.equal(validatePlaylistItems(''), '');
  assert.throws(() => validatePlaylistItems('1-10;rm'));
  assert.throws(() => validatePlaylistItems('one,two'));
});

test('compacts a visual playlist selection into safe yt-dlp ranges', () => {
  assert.equal(compactPlaylistIndices([9, 2, 3, 4, 9, 7, 12, 11]), '2-4,7,9,11-12');
  assert.throws(() => compactPlaylistIndices([]), /at least one/u);
  assert.throws(() => compactPlaylistIndices([1, 2.5, 3]), /invalid item/u);
  assert.throws(() => compactPlaylistIndices(['1', '--exec']), /invalid item/u);
});

test('normalizes visual playlist selections and records their exact count', () => {
  const request = validateDownloadRequest({
    url: 'https://example.com/playlist',
    outputDirectory: './downloads',
    playlistMode: 'playlist',
    selectedPlaylistItems: [5, 1, 2, 2, 3]
  }, { downloadDirectory: './fallback' });

  assert.equal(request.playlistItems, '1-3,5');
  assert.equal(request.selectedItemCount, 4);
});

test('normalizes a complete download request without trusting unknown values', () => {
  const request = validateDownloadRequest({
    url: 'https://example.com/video?id=7',
    outputDirectory: './downloads',
    mediaKind: 'audio',
    audioFormat: 'flac',
    playlistMode: 'single',
    quality: '9999',
    cookiesBrowser: 'unknown',
    embedMetadata: false,
    title: 'A'.repeat(400)
  }, { downloadDirectory: './fallback' });

  assert.equal(request.mediaKind, 'audio');
  assert.equal(request.audioFormat, 'flac');
  assert.equal(request.quality, '1080');
  assert.equal(request.cookiesBrowser, 'none');
  assert.equal(request.embedMetadata, false);
  assert.equal(request.title.length, 300);
  assert.equal(request.outputDirectory, path.resolve('./downloads'));
});

test('clamps performance settings to safe supported ranges', () => {
  const settings = sanitizeSettings({
    downloadDirectory: './out',
    maxConcurrentDownloads: 99,
    fragmentConcurrency: 0,
    ariaConnections: 100,
    retryCount: -5,
    socketTimeout: 400
  }, { downloadDirectory: './fallback' });

  assert.equal(settings.maxConcurrentDownloads, 6);
  assert.equal(settings.fragmentConcurrency, 1);
  assert.equal(settings.ariaConnections, 16);
  assert.equal(settings.retryCount, 0);
  assert.equal(settings.socketTimeout, 120);
});
