'use strict';

const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  STARTING: 'starting',
  DOWNLOADING: 'downloading',
  PROCESSING: 'processing',
  PAUSING: 'pausing',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLING: 'cancelling',
  CANCELLED: 'cancelled'
});

const ACTIVE_STATUSES = new Set([
  JOB_STATUS.STARTING,
  JOB_STATUS.DOWNLOADING,
  JOB_STATUS.PROCESSING,
  JOB_STATUS.PAUSING,
  JOB_STATUS.CANCELLING
]);

const TERMINAL_STATUSES = new Set([
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
  JOB_STATUS.CANCELLED
]);

const DEFAULT_SETTINGS = Object.freeze({
  maxConcurrentDownloads: 2,
  fragmentConcurrency: 8,
  ariaConnections: 8,
  useAria2: true,
  retryCount: 10,
  socketTimeout: 30,
  defaultMediaKind: 'video',
  defaultQuality: '1080',
  defaultVideoContainer: 'mp4',
  defaultAudioFormat: 'mp3',
  embedMetadata: true,
  embedThumbnail: true,
  preventSleep: true,
  minimizeToTray: false,
  cookiesBrowser: 'none'
});

const LIMITS = Object.freeze({
  maxConcurrentDownloads: [1, 6],
  fragmentConcurrency: [1, 32],
  ariaConnections: [1, 16],
  retryCount: [0, 50],
  socketTimeout: [5, 120],
  maxUrlLength: 4096,
  maxPlaylistItemsLength: 24000,
  maxPlaylistSelection: 100000,
  maxLogLines: 500
});

module.exports = {
  JOB_STATUS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  DEFAULT_SETTINGS,
  LIMITS
};
