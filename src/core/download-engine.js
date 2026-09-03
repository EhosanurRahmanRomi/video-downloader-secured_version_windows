'use strict';

const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { buildDownloadArgs, spawnEnvironment } = require('./argument-builder');
const { parseOutputLine, redactLogLine } = require('./progress-parser');

function classifyFailure(lines, code) {
  const text = lines.join('\n').toLowerCase();
  if (/disk full|no space left|not enough space/u.test(text)) return 'The destination drive is out of free space.';
  if (/ffmpeg.*(?:not found|not installed)|postprocessing.*error/u.test(text)) return 'FFmpeg could not process this download. Run the component check in Settings.';
  if (/private video|login required|sign in/u.test(text)) return 'This item requires an account. Choose a browser cookie source in Advanced options.';
  if (/unsupported url/u.test(text)) return 'This website or URL is not supported by the current yt-dlp version.';
  if (/drm protected|known drm/u.test(text)) return 'This media is DRM-protected and cannot be downloaded.';
  if (/http error 429|too many requests/u.test(text)) return 'The website is rate-limiting requests. Wait a while, reduce concurrency, then retry.';
  if (/video unavailable|not available|removed by/u.test(text)) return 'This media is unavailable or has been removed.';
  if (/unable to download|network is unreachable|timed out|connection/u.test(text)) return 'The download failed because of a network or website connection error. Retry when the connection is stable.';
  return `Download process exited with code ${code ?? 'unknown'}. Open the log for details.`;
}

class DownloadEngine extends EventEmitter {
  constructor({ job, settings, tools, spawnImpl = spawn }) {
    super();
    this.job = job;
    this.settings = settings;
    this.tools = tools;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.stopReason = '';
    this.settled = false;
    this.errorLines = [];
    this.forceTimer = null;
  }

  start() {
    return new Promise((resolve) => {
      if (!this.tools.ready) {
        resolve({ outcome: 'failed', error: this.tools.error || 'Download components are unavailable.' });
        return;
      }

      const args = buildDownloadArgs(this.job, this.settings, this.tools);
      const env = spawnEnvironment(this.tools);
      try {
        this.child = this.spawnImpl(this.tools.ytDlpPath, args, {
          cwd: this.job.outputDirectory,
          env,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        resolve({ outcome: 'failed', error: `Could not start yt-dlp: ${error.message}` });
        return;
      }

      this.emit('started', { pid: this.child.pid });
      this.consumeStream(this.child.stdout);
      this.consumeStream(this.child.stderr);

      this.child.once('error', (error) => {
        this.finish(resolve, { outcome: 'failed', error: `Could not start yt-dlp: ${error.message}` });
      });
      this.child.once('close', (code, signal) => {
        if (this.stopReason === 'pause') {
          this.finish(resolve, { outcome: 'paused' });
        } else if (this.stopReason === 'cancel' || this.stopReason === 'shutdown') {
          this.finish(resolve, { outcome: this.stopReason === 'cancel' ? 'cancelled' : 'paused' });
        } else if (code === 0) {
          this.finish(resolve, { outcome: 'completed' });
        } else {
          this.finish(resolve, {
            outcome: 'failed',
            error: classifyFailure(this.errorLines, code),
            code,
            signal
          });
        }
      });
    });
  }

  consumeStream(stream) {
    if (!stream) return;
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    reader.on('line', (rawLine) => {
      const parsed = parseOutputLine(rawLine);
      if (!parsed) return;
      if (parsed.type === 'log') {
        const safeMessage = redactLogLine(parsed.message);
        if (parsed.level === 'error' || /\b(error|failed|unable)\b/iu.test(safeMessage)) {
          this.errorLines.push(safeMessage);
          if (this.errorLines.length > 80) this.errorLines.shift();
        }
        this.emit('log', { ...parsed, message: safeMessage });
      } else {
        this.emit(parsed.type, parsed);
      }
    });
  }

  finish(resolve, result) {
    if (this.settled) return;
    this.settled = true;
    if (this.forceTimer) clearTimeout(this.forceTimer);
    resolve(result);
  }

  stop(reason) {
    if (!this.child || this.settled || this.stopReason) return;
    this.stopReason = reason;
    if (process.platform === 'win32' && this.child.pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.unref();
    } else {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // The close handler will settle a process that already exited.
      }
    }

    if (this.settled) return;
    this.forceTimer = setTimeout(() => {
      if (!this.child || this.settled) return;
      if (process.platform !== 'win32') {
        try {
          this.child.kill('SIGKILL');
        } catch {
          // The process already ended.
        }
      }
    }, 4_000);
    this.forceTimer.unref?.();
  }
}

module.exports = { DownloadEngine, classifyFailure };
