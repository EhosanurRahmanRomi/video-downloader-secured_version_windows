'use strict';

const path = require('node:path');
const { DEFAULT_SETTINGS, LIMITS } = require('./constants');

const MEDIA_KINDS = new Set(['video', 'audio']);
const PLAYLIST_MODES = new Set(['auto', 'single', 'playlist']);
const VIDEO_QUALITIES = new Set(['best', '2160', '1440', '1080', '720', '480', '360']);
const VIDEO_CONTAINERS = new Set(['auto', 'mp4', 'mkv', 'webm']);
const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'opus', 'flac', 'wav']);
const COOKIE_BROWSERS = new Set(['none', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function normalizeHttpUrl(rawValue) {
  if (typeof rawValue !== 'string') {
    throw new Error('Enter a valid video or playlist URL.');
  }

  const value = rawValue.trim();
  if (!value || value.length > LIMITS.maxUrlLength || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new Error('Enter a valid video or playlist URL.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The URL is not valid. Include https:// at the beginning.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new Error('Only public HTTP and HTTPS URLs are supported.');
  }

  return url.toString();
}

function canonicalizeUrl(rawValue) {
  const url = new URL(normalizeHttpUrl(rawValue));
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|si$|feature$)/iu.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

function validatePlaylistItems(value) {
  const trimmed = String(value || '').replace(/\s+/gu, '');
  if (!trimmed) return '';
  if (trimmed.length > LIMITS.maxPlaylistItemsLength) {
    throw new Error('The playlist item selection is too long.');
  }

  const token = '(?:\\d+-\\d+|-?\\d+|-?\\d*:-?\\d*(?::-?\\d+)?)';
  const matcher = new RegExp(`^${token}(?:,${token})*$`, 'u');
  if (!matcher.test(trimmed)) {
    throw new Error('Playlist items must look like 1-10,15 or 1:20:2.');
  }
  return trimmed;
}

function compactPlaylistIndices(value) {
  if (!Array.isArray(value)) {
    throw new Error('The playlist selection is invalid. Analyze the playlist again.');
  }
  if (!value.length) {
    throw new Error('Select at least one playlist video.');
  }
  if (value.length > LIMITS.maxPlaylistSelection) {
    throw new Error('This playlist selection is too large to process safely.');
  }

  const indices = [...new Set(value.map((item) => {
    const number = Number(item);
    if (!Number.isSafeInteger(number) || number < 1 || number > 1_000_000) {
      throw new Error('The playlist selection contains an invalid item number.');
    }
    return number;
  }))].sort((left, right) => left - right);

  const ranges = [];
  let start = indices[0];
  let end = start;
  for (const index of indices.slice(1)) {
    if (index === end + 1) {
      end = index;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = index;
    end = index;
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return validatePlaylistItems(ranges.join(','));
}

function validateOutputDirectory(value, fallback) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\u0000')) {
    throw new Error('Choose a valid download folder.');
  }
  return path.resolve(candidate);
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function validateDownloadRequest(input, defaults = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid download request.');

  const mediaKind = enumValue(input.mediaKind, MEDIA_KINDS, DEFAULT_SETTINGS.defaultMediaKind);
  const playlistMode = enumValue(input.playlistMode, PLAYLIST_MODES, 'auto');

  const hasVisualSelection = Object.hasOwn(input, 'selectedPlaylistItems');
  const playlistItems = hasVisualSelection
    ? compactPlaylistIndices(input.selectedPlaylistItems)
    : validatePlaylistItems(input.playlistItems);

  return {
    url: normalizeHttpUrl(input.url),
    canonicalUrl: canonicalizeUrl(input.url),
    outputDirectory: validateOutputDirectory(input.outputDirectory, defaults.downloadDirectory),
    mediaKind,
    playlistMode,
    playlistItems,
    selectedItemCount: hasVisualSelection ? new Set(input.selectedPlaylistItems.map(Number)).size : 0,
    quality: enumValue(input.quality, VIDEO_QUALITIES, DEFAULT_SETTINGS.defaultQuality),
    videoContainer: enumValue(input.videoContainer, VIDEO_CONTAINERS, DEFAULT_SETTINGS.defaultVideoContainer),
    audioFormat: enumValue(input.audioFormat, AUDIO_FORMATS, DEFAULT_SETTINGS.defaultAudioFormat),
    embedMetadata: bool(input.embedMetadata, DEFAULT_SETTINGS.embedMetadata),
    embedThumbnail: bool(input.embedThumbnail, DEFAULT_SETTINGS.embedThumbnail),
    includeSubtitles: bool(input.includeSubtitles),
    includeAutoSubtitles: bool(input.includeAutoSubtitles),
    removeSponsorSegments: bool(input.removeSponsorSegments),
    overwrite: bool(input.overwrite),
    cookiesBrowser: enumValue(input.cookiesBrowser, COOKIE_BROWSERS, DEFAULT_SETTINGS.cookiesBrowser),
    title: typeof input.title === 'string' ? input.title.trim().slice(0, 300) : '',
    thumbnail: typeof input.thumbnail === 'string' && /^https?:\/\//iu.test(input.thumbnail) ? input.thumbnail : '',
    sourceLabel: typeof input.sourceLabel === 'string' ? input.sourceLabel.trim().slice(0, 120) : ''
  };
}

function sanitizeSettings(input, defaults = {}) {
  const candidate = isPlainObject(input) ? input : {};
  const [minJobs, maxJobs] = LIMITS.maxConcurrentDownloads;
  const [minFragments, maxFragments] = LIMITS.fragmentConcurrency;
  const [minAria, maxAria] = LIMITS.ariaConnections;
  const [minRetries, maxRetries] = LIMITS.retryCount;
  const [minTimeout, maxTimeout] = LIMITS.socketTimeout;

  return {
    ...DEFAULT_SETTINGS,
    downloadDirectory: validateOutputDirectory(candidate.downloadDirectory, defaults.downloadDirectory),
    maxConcurrentDownloads: clampInteger(candidate.maxConcurrentDownloads, DEFAULT_SETTINGS.maxConcurrentDownloads, minJobs, maxJobs),
    fragmentConcurrency: clampInteger(candidate.fragmentConcurrency, DEFAULT_SETTINGS.fragmentConcurrency, minFragments, maxFragments),
    ariaConnections: clampInteger(candidate.ariaConnections, DEFAULT_SETTINGS.ariaConnections, minAria, maxAria),
    useAria2: bool(candidate.useAria2, DEFAULT_SETTINGS.useAria2),
    retryCount: clampInteger(candidate.retryCount, DEFAULT_SETTINGS.retryCount, minRetries, maxRetries),
    socketTimeout: clampInteger(candidate.socketTimeout, DEFAULT_SETTINGS.socketTimeout, minTimeout, maxTimeout),
    defaultMediaKind: enumValue(candidate.defaultMediaKind, MEDIA_KINDS, DEFAULT_SETTINGS.defaultMediaKind),
    defaultQuality: enumValue(candidate.defaultQuality, VIDEO_QUALITIES, DEFAULT_SETTINGS.defaultQuality),
    defaultVideoContainer: enumValue(candidate.defaultVideoContainer, VIDEO_CONTAINERS, DEFAULT_SETTINGS.defaultVideoContainer),
    defaultAudioFormat: enumValue(candidate.defaultAudioFormat, AUDIO_FORMATS, DEFAULT_SETTINGS.defaultAudioFormat),
    embedMetadata: bool(candidate.embedMetadata, DEFAULT_SETTINGS.embedMetadata),
    embedThumbnail: bool(candidate.embedThumbnail, DEFAULT_SETTINGS.embedThumbnail),
    preventSleep: bool(candidate.preventSleep, DEFAULT_SETTINGS.preventSleep),
    minimizeToTray: bool(candidate.minimizeToTray, DEFAULT_SETTINGS.minimizeToTray),
    cookiesBrowser: enumValue(candidate.cookiesBrowser, COOKIE_BROWSERS, DEFAULT_SETTINGS.cookiesBrowser)
  };
}

module.exports = {
  normalizeHttpUrl,
  canonicalizeUrl,
  validatePlaylistItems,
  compactPlaylistIndices,
  validateDownloadRequest,
  sanitizeSettings,
  clampInteger
};
