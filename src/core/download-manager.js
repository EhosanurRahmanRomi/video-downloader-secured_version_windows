'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DownloadEngine } = require('./download-engine');
const { validateDownloadRequest } = require('./validation');
const { JOB_STATUS, ACTIVE_STATUSES, TERMINAL_STATUSES, LIMITS } = require('./constants');

function isoNow() {
  return new Date().toISOString();
}

function archiveKey(request) {
  const identity = JSON.stringify({
    url: request.canonicalUrl,
    outputDirectory: request.outputDirectory,
    mediaKind: request.mediaKind,
    audioFormat: request.audioFormat,
    videoContainer: request.videoContainer,
    quality: request.quality,
    playlistMode: request.playlistMode,
    playlistItems: request.playlistItems
  });
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function duplicateKey(job) {
  return archiveKey(job);
}

function publicJob(job) {
  const { logs, ...visible } = job;
  return { ...visible, logCount: Array.isArray(logs) ? logs.length : 0 };
}

class DownloadManager extends EventEmitter {
  constructor({
    jobsStore,
    archiveDirectory,
    getSettings,
    getTools,
    runnerFactory = (options) => new DownloadEngine(options)
  }) {
    super();
    this.jobsStore = jobsStore;
    this.archiveDirectory = archiveDirectory;
    this.getSettings = getSettings;
    this.getTools = getTools;
    this.runnerFactory = runnerFactory;
    this.jobs = [];
    this.engines = new Map();
    this.persistTimer = null;
    this.shuttingDown = false;
    fs.mkdirSync(archiveDirectory, { recursive: true });
    this.restore();
  }

  restore() {
    const saved = this.jobsStore.read([]);
    this.jobs = Array.isArray(saved) ? saved.slice(-500).map((job) => {
      const wasActive = ACTIVE_STATUSES.has(job.status);
      return {
        ...job,
        status: wasActive ? JOB_STATUS.PAUSED : job.status,
        error: wasActive ? 'The app closed before this job finished. Resume to continue from its partial file.' : (job.error || ''),
        speed: 0,
        eta: 0,
        logs: Array.isArray(job.logs) ? job.logs.slice(-LIMITS.maxLogLines) : []
      };
    }) : [];
    this.persistNow();
  }

  start() {
    this.shuttingDown = false;
    this.pump();
  }

  add(input) {
    const settings = this.getSettings();
    const request = validateDownloadRequest(input, { downloadDirectory: settings.downloadDirectory });
    const key = duplicateKey(request);
    const existing = this.jobs.find((job) => duplicateKey(job) === key && !TERMINAL_STATUSES.has(job.status));
    if (existing) {
      throw new Error('This exact download is already queued or active.');
    }

    const id = crypto.randomUUID();
    const createdAt = isoNow();
    const job = {
      id,
      ...request,
      archivePath: path.join(this.archiveDirectory, request.overwrite ? `${archiveKey(request)}-${id}.txt` : `${archiveKey(request)}.txt`),
      status: JOB_STATUS.QUEUED,
      progress: 0,
      itemProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      eta: 0,
      currentItem: '',
      currentItemIndex: 0,
      itemCount: request.selectedItemCount || 0,
      outputFiles: [],
      error: '',
      lastMessage: 'Waiting in queue',
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
      startedAt: '',
      completedAt: '',
      logs: []
    };
    this.jobs.push(job);
    this.trimHistory();
    this.changed();
    this.pump();
    return publicJob(job);
  }

  trimHistory() {
    if (this.jobs.length <= 500) return;
    const removable = this.jobs.filter((job) => TERMINAL_STATUSES.has(job.status));
    while (this.jobs.length > 500 && removable.length) {
      const oldest = removable.shift();
      this.jobs.splice(this.jobs.indexOf(oldest), 1);
    }
  }

  async runJob(job) {
    fs.mkdirSync(job.outputDirectory, { recursive: true });
    job.status = JOB_STATUS.STARTING;
    job.startedAt ||= isoNow();
    job.updatedAt = isoNow();
    job.attempts += 1;
    job.error = '';
    job.lastMessage = 'Starting yt-dlp…';
    this.changed();

    const engine = this.runnerFactory({
      job,
      settings: this.getSettings(),
      tools: this.getTools()
    });
    this.engines.set(job.id, engine);

    engine.on('started', () => {
      job.status = JOB_STATUS.DOWNLOADING;
      job.lastMessage = 'Connecting…';
      job.updatedAt = isoNow();
      this.changed();
    });
    engine.on('progress', (event) => this.handleProgress(job, event));
    engine.on('item', (event) => this.handleItem(job, event));
    engine.on('file', (event) => this.handleFile(job, event));
    engine.on('log', (event) => this.handleLog(job, event));

    let result;
    try {
      result = await engine.start();
    } catch (error) {
      result = { outcome: 'failed', error: error.message };
    }
    this.engines.delete(job.id);
    this.finishJob(job, result);
    this.pump();
  }

  handleProgress(job, event) {
    if (event.status === 'finished') {
      job.status = JOB_STATUS.PROCESSING;
      job.lastMessage = 'Merging and processing…';
    } else if (!['pausing', 'cancelling'].includes(job.status)) {
      job.status = JOB_STATUS.DOWNLOADING;
      const itemContext = job.currentItemIndex
        ? `Item ${job.currentItemIndex}${job.itemCount ? ` of ${job.itemCount}` : ''}${job.currentPlaylistIndex && job.currentPlaylistIndex !== job.currentItemIndex ? ` (playlist #${job.currentPlaylistIndex})` : ''}`
        : '';
      const progressMessage = event.speedText ? `Downloading at ${event.speedText}` : 'Downloading…';
      job.lastMessage = itemContext ? `${itemContext}: ${job.currentItem} · ${progressMessage}` : progressMessage;
    }
    job.itemProgress = event.percent;
    job.downloadedBytes = event.downloadedBytes || job.downloadedBytes;
    job.totalBytes = event.totalBytes || job.totalBytes;
    job.speed = event.speed;
    job.speedText = event.speedText;
    job.eta = event.eta;
    job.etaText = event.etaText;
    if (job.itemCount > 1 && job.currentItemIndex > 0) {
      job.progress = Math.min(100, (((job.currentItemIndex - 1) + event.percent / 100) / job.itemCount) * 100);
    } else {
      job.progress = event.percent;
    }
    job.updatedAt = isoNow();
    this.changed(false);
  }

  handleItem(job, event) {
    job.currentItem = String(event.title || '').slice(0, 300);
    job.currentPlaylistIndex = Number(event.playlist_index) || 0;
    job.currentItemIndex = Number(event.playlist_autonumber) || job.currentPlaylistIndex;
    job.itemCount = job.selectedItemCount || Number(event.n_entries) || Number(event.playlist_count) || job.itemCount || 0;
    job.lastMessage = job.currentItemIndex
      ? `Item ${job.currentItemIndex}${job.itemCount ? ` of ${job.itemCount}` : ''}${job.currentPlaylistIndex && job.currentPlaylistIndex !== job.currentItemIndex ? ` (playlist #${job.currentPlaylistIndex})` : ''}: ${job.currentItem}`
      : job.currentItem || 'Preparing media…';
    job.updatedAt = isoNow();
    this.changed();
  }

  handleFile(job, event) {
    if (event.path && !job.outputFiles.includes(event.path)) {
      job.outputFiles.push(event.path);
      if (job.outputFiles.length > 1000) job.outputFiles.shift();
    }
    job.lastMessage = 'File saved';
    job.updatedAt = isoNow();
    this.changed();
  }

  handleLog(job, event) {
    const entry = { at: isoNow(), level: event.level || 'info', message: event.message };
    job.logs.push(entry);
    if (job.logs.length > LIMITS.maxLogLines) job.logs.shift();
    if (event.level === 'error') job.lastMessage = event.message.slice(0, 220);
    job.updatedAt = isoNow();
    this.changed(false);
  }

  finishJob(job, result) {
    job.speed = 0;
    job.eta = 0;
    job.updatedAt = isoNow();
    if (result.outcome === 'completed') {
      job.status = JOB_STATUS.COMPLETED;
      job.progress = 100;
      job.itemProgress = 100;
      job.completedAt = isoNow();
      job.lastMessage = job.outputFiles.length > 1 ? `${job.outputFiles.length} files saved` : 'Download complete';
      job.error = '';
    } else if (result.outcome === 'paused') {
      job.status = JOB_STATUS.PAUSED;
      job.lastMessage = 'Paused — partial data is preserved';
    } else if (result.outcome === 'cancelled') {
      job.status = JOB_STATUS.CANCELLED;
      job.lastMessage = 'Cancelled';
    } else {
      job.status = JOB_STATUS.FAILED;
      job.error = result.error || 'The download failed. Open the log for details.';
      job.lastMessage = job.error;
    }
    this.changed();
  }

  action(id, action) {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error('Download job not found.');
    const engine = this.engines.get(id);

    if (action === 'pause') {
      if (job.status === JOB_STATUS.QUEUED) {
        job.status = JOB_STATUS.PAUSED;
        job.lastMessage = 'Paused in queue';
      } else if (engine && ACTIVE_STATUSES.has(job.status)) {
        job.status = JOB_STATUS.PAUSING;
        job.lastMessage = 'Pausing safely…';
        engine.stop('pause');
      } else {
        throw new Error('Only queued or active downloads can be paused.');
      }
    } else if (action === 'resume' || action === 'retry') {
      if (![JOB_STATUS.PAUSED, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED].includes(job.status)) {
        throw new Error('This download cannot be resumed right now.');
      }
      job.status = JOB_STATUS.QUEUED;
      job.error = '';
      job.lastMessage = 'Waiting in queue';
      job.completedAt = '';
    } else if (action === 'cancel') {
      if (engine && ACTIVE_STATUSES.has(job.status)) {
        job.status = JOB_STATUS.CANCELLING;
        job.lastMessage = 'Cancelling…';
        engine.stop('cancel');
      } else if ([JOB_STATUS.QUEUED, JOB_STATUS.PAUSED, JOB_STATUS.FAILED].includes(job.status)) {
        job.status = JOB_STATUS.CANCELLED;
        job.lastMessage = 'Cancelled';
      } else {
        throw new Error('This download cannot be cancelled right now.');
      }
    } else if (action === 'remove') {
      if (engine || ACTIVE_STATUSES.has(job.status)) throw new Error('Pause or cancel this download before removing it.');
      this.jobs.splice(this.jobs.indexOf(job), 1);
      this.changed();
      return null;
    } else {
      throw new Error('Unknown download action.');
    }

    job.updatedAt = isoNow();
    this.changed();
    this.pump();
    return publicJob(job);
  }

  clearFinished() {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((job) => ![JOB_STATUS.COMPLETED, JOB_STATUS.CANCELLED].includes(job.status));
    this.changed();
    return before - this.jobs.length;
  }

  getLog(id) {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error('Download job not found.');
    return {
      id: job.id,
      title: job.title || job.currentItem || job.url,
      error: job.error,
      entries: job.logs.slice()
    };
  }

  getJob(id) {
    const job = this.jobs.find((candidate) => candidate.id === id);
    return job ? publicJob(job) : null;
  }

  getSnapshot() {
    const stats = {
      total: this.jobs.length,
      active: 0,
      queued: 0,
      completed: 0,
      failed: 0,
      combinedSpeed: 0
    };
    for (const job of this.jobs) {
      if (ACTIVE_STATUSES.has(job.status)) stats.active += 1;
      if (job.status === JOB_STATUS.QUEUED) stats.queued += 1;
      if (job.status === JOB_STATUS.COMPLETED) stats.completed += 1;
      if (job.status === JOB_STATUS.FAILED) stats.failed += 1;
      stats.combinedSpeed += Number(job.speed) || 0;
    }
    return { jobs: this.jobs.map(publicJob).reverse(), stats };
  }

  pump() {
    if (this.shuttingDown) return;
    queueMicrotask(() => {
      if (this.shuttingDown) return;
      const limit = this.getSettings().maxConcurrentDownloads;
      let available = Math.max(0, limit - this.engines.size);
      for (const job of this.jobs) {
        if (!available || job.status !== JOB_STATUS.QUEUED) continue;
        available -= 1;
        void this.runJob(job);
      }
    });
  }

  settingsChanged() {
    this.changed();
    this.pump();
  }

  changed(immediatePersist = true) {
    this.emit('state', this.getSnapshot());
    if (immediatePersist) this.persistNow();
    else this.schedulePersist();
  }

  schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 500);
    this.persistTimer.unref?.();
  }

  persistNow() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.jobsStore.write(this.jobs);
  }

  shutdown() {
    this.shuttingDown = true;
    for (const [id, engine] of this.engines) {
      const job = this.jobs.find((candidate) => candidate.id === id);
      if (job) {
        job.status = JOB_STATUS.PAUSED;
        job.speed = 0;
        job.eta = 0;
        job.lastMessage = 'Paused when the app closed — resume to continue';
        job.updatedAt = isoNow();
      }
      engine.stop('shutdown');
    }
    this.persistNow();
  }
}

module.exports = { DownloadManager, archiveKey, duplicateKey, publicJob };
