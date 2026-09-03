'use strict';

const { spawn } = require('node:child_process');
const { buildInspectArgs, spawnEnvironment } = require('./argument-builder');
const { normalizeHttpUrl } = require('./validation');
const { redactLogLine } = require('./progress-parser');

const MAX_INSPECTION_BYTES = 64 * 1024 * 1024;

function safeText(value, maxLength, fallback = '') {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function safeImageUrl(value) {
  const url = safeText(value, 4096);
  return /^https?:\/\//iu.test(url) ? url : '';
}

function sanitizePlaylistEntry(entry, offset) {
  const indexValue = Number(entry?.playlist_index || entry?.playlist_autonumber);
  const index = Number.isSafeInteger(indexValue) && indexValue > 0 ? indexValue : offset + 1;
  if (!entry || typeof entry !== 'object') {
    return {
      index,
      id: '',
      title: 'Unavailable video',
      sourceLabel: '',
      thumbnail: '',
      duration: 0,
      availability: 'unavailable',
      selectable: false
    };
  }

  const title = safeText(entry.title, 300, `Video ${index}`);
  const deleted = /^\[?deleted video\]?$/iu.test(title);
  const duration = Number(entry.duration);
  return {
    index,
    id: safeText(entry.id, 160),
    title,
    sourceLabel: safeText(entry.channel || entry.uploader || entry.creator, 120),
    thumbnail: safeImageUrl(entry.thumbnail),
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    availability: safeText(entry.availability || entry.live_status, 40),
    selectable: !deleted
  };
}

function inspectionFromData(data, safeUrl) {
  const rawEntries = Array.isArray(data.entries) ? data.entries : [];
  const entries = rawEntries.map(sanitizePlaylistEntry);
  const firstRaw = rawEntries.find((entry) => entry && typeof entry === 'object') || data;
  const first = entries.find((entry) => entry.selectable) || entries[0];
  const isPlaylist = data._type === 'playlist' || rawEntries.length > 1;
  const totalDuration = entries.reduce((total, entry) => total + entry.duration, 0);
  const knownDurationCount = entries.filter((entry) => entry.duration > 0).length;

  return {
    title: safeText(data.title || firstRaw.title, 300, 'Untitled media'),
    sourceLabel: safeText(data.channel || data.uploader || data.extractor_key || firstRaw.channel || firstRaw.uploader, 120),
    thumbnail: safeImageUrl(data.thumbnail || firstRaw.thumbnail || first?.thumbnail),
    duration: Number(data.duration || firstRaw.duration) || 0,
    isPlaylist,
    playlistCount: isPlaylist ? Math.max(Number(data.playlist_count) || 0, entries.length) : 0,
    listedCount: entries.length,
    selectableCount: entries.filter((entry) => entry.selectable).length,
    unavailableCount: entries.filter((entry) => !entry.selectable).length,
    totalDuration,
    knownDurationCount,
    entries: isPlaylist ? entries : [],
    extractor: safeText(data.extractor_key || data.extractor, 80),
    webpageUrl: safeUrl
  };
}

function inspectMedia({ url, cookiesBrowser, tools, spawnImpl = spawn, timeoutMs = 120_000 }) {
  const safeUrl = normalizeHttpUrl(url);
  if (!tools.ready) return Promise.reject(new Error(tools.error || 'Download components are unavailable.'));

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let stdoutBytes = 0;
    let exceededLimit = false;
    const child = spawnImpl(tools.ytDlpPath, buildInspectArgs(safeUrl, cookiesBrowser), {
      windowsHide: true,
      shell: false,
      env: spawnEnvironment(tools),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Analysis timed out. You can still add the URL directly to the queue.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_INSPECTION_BYTES) {
        stdout += chunk.toString('utf8');
      } else if (!exceededLimit) {
        exceededLimit = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 128 * 1024) stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not analyze this URL: ${error.message}`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exceededLimit) {
        reject(new Error('This playlist is too large to analyze in one pass. Narrow the playlist URL and try again.'));
        return;
      }
      if (code !== 0) {
        reject(new Error(redactLogLine(stderr).slice(-600) || 'The website did not return media information.'));
        return;
      }

      try {
        const data = JSON.parse(stdout.trim());
        resolve(inspectionFromData(data, safeUrl));
      } catch {
        reject(new Error('The website returned media information in an unexpected format. Update yt-dlp and try again.'));
      }
    });
  });
}

module.exports = { inspectMedia, inspectionFromData, sanitizePlaylistEntry, MAX_INSPECTION_BYTES };
