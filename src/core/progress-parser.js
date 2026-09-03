'use strict';

const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/gu;

function stripAnsi(value) {
  return String(value || '').replace(ANSI_PATTERN, '').trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function parsePercent(value) {
  if (typeof value === 'number') return Math.min(100, Math.max(0, value));
  const text = String(value ?? '').trim();
  const match = text.match(/^([\d.]+)%?$/u);
  return match ? Math.min(100, Math.max(0, Number(match[1]))) : 0;
}

function parseProgressObject(progress) {
  const downloadedBytes = finiteNumber(progress.downloaded_bytes);
  const totalBytes = finiteNumber(progress.total_bytes || progress.total_bytes_estimate);
  const percent = parsePercent(progress._percent_str || (totalBytes ? (downloadedBytes / totalBytes) * 100 : 0));
  return {
    type: 'progress',
    status: progress.status || 'downloading',
    percent,
    downloadedBytes,
    totalBytes,
    speed: finiteNumber(progress.speed),
    eta: finiteNumber(progress.eta),
    speedText: stripAnsi(progress._speed_str || ''),
    etaText: stripAnsi(progress._eta_str || '')
  };
}

function parseFallbackProgress(line) {
  const match = line.match(/^\[download\]\s+([\d.]+)%.*?(?:of\s+~?\s*([^\s]+))?.*?(?:at\s+([^\s]+))?.*?(?:ETA\s+([\d:]+))?$/iu);
  if (!match) return null;
  return {
    type: 'progress',
    status: 'downloading',
    percent: parsePercent(match[1]),
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    eta: 0,
    totalText: match[2] || '',
    speedText: match[3] || '',
    etaText: match[4] || ''
  };
}

function parseOutputLine(rawLine) {
  const line = stripAnsi(rawLine);
  if (!line) return null;

  const prefixes = [
    ['__VAI_PROGRESS__', 'progress'],
    ['__VAI_ITEM__', 'item'],
    ['__VAI_FILE__', 'file']
  ];

  for (const [prefix, type] of prefixes) {
    const index = line.indexOf(prefix);
    if (index !== -1) {
      const payload = line.slice(index + prefix.length);
      try {
        const parsed = JSON.parse(payload);
        if (type === 'progress') return parseProgressObject(parsed);
        if (type === 'file') return { type, path: typeof parsed === 'string' ? parsed : String(parsed || '') };
        return { type, ...parsed };
      } catch {
        return { type: 'log', level: 'debug', message: line };
      }
    }
  }

  return parseFallbackProgress(line) || {
    type: 'log',
    level: /\b(error|failed|unable)\b/iu.test(line) ? 'error' : 'info',
    message: line
  };
}

function redactLogLine(line) {
  return stripAnsi(line)
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]+/giu, '$1?[query hidden]')
    .replace(/((?:token|signature|authorization|cookie|password)=)[^\s&]+/giu, '$1[hidden]');
}

module.exports = {
  stripAnsi,
  parsePercent,
  parseProgressObject,
  parseOutputLine,
  redactLogLine
};
