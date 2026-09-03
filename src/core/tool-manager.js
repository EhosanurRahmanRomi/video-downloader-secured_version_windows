'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JsonStore } = require('./json-store');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function hasPeHeader(filePath) {
  try {
    const handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(2);
    fs.readSync(handle, header, 0, 2, 0);
    fs.closeSync(handle);
    return header.toString('ascii') === 'MZ';
  } catch {
    return false;
  }
}

function compareVersions(left, right) {
  const leftParts = String(left || '').match(/\d+/gu)?.map(Number) || [];
  const rightParts = String(right || '').match(/\d+/gu)?.map(Number) || [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function runVersion(executable, args, options = {}) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let timedOut = false;
    const { timeoutMs = 12_000, ...spawnOptions } = options;
    let child;
    try {
      child = spawn(executable, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...spawnOptions
      });
    } catch (error) {
      resolve({ ok: false, version: '', error: error.message });
      return;
    }
    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill();
      }
    }, timeoutMs);

    const collect = (chunk) => {
      if (output.length < 16_384) output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, version: '', error: error.message });
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        version: output.trim().split(/\r?\n/u)[0] || '',
        error: timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)} seconds` : (code === 0 ? '' : output.trim() || `Exited with code ${code}`)
      });
    });
  });
}

class ToolManager {
  constructor({ bundledDirectory, userDataDirectory, platform = process.platform }) {
    this.bundledDirectory = bundledDirectory;
    this.userDataDirectory = userDataDirectory;
    this.platform = platform;
    this.runtimeDirectory = path.join(userDataDirectory, 'runtime');
    this.stateStore = new JsonStore(path.join(this.runtimeDirectory, 'tool-state.json'));
    this.manifest = null;
    this.toolPaths = null;
  }

  loadManifest() {
    const manifestPath = path.join(this.bundledDirectory, 'tools-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || !manifest.files || typeof manifest.files !== 'object') {
      throw new Error('The bundled tool manifest is invalid. Reinstall VideoAI Downloader.');
    }
    return manifest;
  }

  verifyBundledFile(filename) {
    const expected = this.manifest.files[filename];
    const filePath = path.join(this.bundledDirectory, filename);
    if (!expected || !fs.existsSync(filePath) || !hasPeHeader(filePath)) return false;
    if (Number(expected.size) !== fs.statSync(filePath).size) return false;
    return sha256(filePath) === expected.sha256;
  }

  initialize() {
    fs.mkdirSync(this.runtimeDirectory, { recursive: true });
    try {
      this.manifest = this.loadManifest();
    } catch (error) {
      this.toolPaths = {
        ready: false,
        error: error.message,
        ytDlpPath: '',
        ffmpegDirectory: '',
        aria2Available: false,
        binDirectory: this.bundledDirectory
      };
      return this.toolPaths;
    }

    const required = Object.entries(this.manifest.files)
      .filter(([, metadata]) => metadata.required !== false)
      .map(([filename]) => filename);
    const invalid = required.filter((filename) => !this.verifyBundledFile(filename));
    const aria2Available = this.verifyBundledFile('aria2c.exe');
    if (invalid.length) {
      this.toolPaths = {
        ready: false,
        error: `Missing or damaged component: ${invalid.join(', ')}. Reinstall VideoAI Downloader.`,
        ytDlpPath: '',
        ffmpegDirectory: '',
        aria2Available,
        binDirectory: this.bundledDirectory
      };
      return this.toolPaths;
    }

    const bundledYtDlp = path.join(this.bundledDirectory, 'yt-dlp.exe');
    const activeYtDlp = path.join(this.runtimeDirectory, 'yt-dlp.exe');
    const state = this.stateStore.read({});
    const activeValid = fs.existsSync(activeYtDlp) && hasPeHeader(activeYtDlp);
    const bundledIsNewer = compareVersions(this.manifest.ytDlpVersion, state.ytDlpVersion) > 0;
    if (!activeValid || bundledIsNewer) {
      fs.copyFileSync(bundledYtDlp, activeYtDlp);
      fs.chmodSync(activeYtDlp, 0o755);
      this.stateStore.write({
        seededFromAppVersion: this.manifest.appVersion,
        ytDlpVersion: this.manifest.ytDlpVersion,
        seededAt: new Date().toISOString()
      });
    } else if (!state.seededFromAppVersion) {
      this.stateStore.write({ ...state, seededFromAppVersion: this.manifest.appVersion });
    }

    this.toolPaths = {
      ready: true,
      error: '',
      ytDlpPath: activeYtDlp,
      ffmpegDirectory: this.bundledDirectory,
      aria2Available,
      binDirectory: this.bundledDirectory,
      versions: {
        ytDlp: this.manifest.ytDlpVersion || '',
        ffmpeg: this.manifest.ffmpegVersion || '',
        aria2: this.manifest.aria2Version || ''
      }
    };
    return this.toolPaths;
  }

  getTools() {
    return this.toolPaths || this.initialize();
  }

  publicStatus() {
    const tools = this.getTools();
    return {
      ready: tools.ready,
      error: tools.error,
      aria2Available: tools.aria2Available,
      versions: tools.versions || {}
    };
  }

  async healthCheck() {
    const tools = this.getTools();
    if (!tools.ready) return this.publicStatus();
    if (this.platform !== 'win32') {
      return { ...this.publicStatus(), verified: true, note: 'Windows PE files passed checksum verification.' };
    }

    const environment = {
      ...process.env,
      PATH: `${tools.binDirectory}${path.delimiter}${process.env.PATH || ''}`
    };
    const [ytDlp, ffmpeg, aria2] = await Promise.all([
      runVersion(tools.ytDlpPath, ['--version'], { env: environment }),
      runVersion(path.join(tools.ffmpegDirectory, 'ffmpeg.exe'), ['-version'], { env: environment }),
      tools.aria2Available
        ? runVersion(path.join(tools.binDirectory, 'aria2c.exe'), ['--version'], { env: environment })
        : Promise.resolve({ ok: false, version: '', error: 'Not bundled' })
    ]);

    return {
      ready: ytDlp.ok && ffmpeg.ok,
      error: ytDlp.ok && ffmpeg.ok ? '' : 'One or more download components failed their launch check.',
      aria2Available: aria2.ok,
      versions: {
        ytDlp: ytDlp.version,
        ffmpeg: ffmpeg.version,
        aria2: aria2.version
      },
      details: { ytDlp, ffmpeg, aria2 },
      verified: ytDlp.ok && ffmpeg.ok
    };
  }

  async updateYtDlp() {
    const tools = this.getTools();
    if (!tools.ready) throw new Error(tools.error || 'Download components are unavailable.');
    if (this.platform !== 'win32') throw new Error('yt-dlp can only be updated from the Windows application.');

    const backup = `${tools.ytDlpPath}.backup`;
    fs.copyFileSync(tools.ytDlpPath, backup);
    const result = await runVersion(tools.ytDlpPath, ['--update-to', 'stable'], {
      env: { ...process.env, PATH: `${tools.binDirectory}${path.delimiter}${process.env.PATH || ''}` },
      timeoutMs: 120_000
    });

    if (!result.ok || !hasPeHeader(tools.ytDlpPath)) {
      fs.copyFileSync(backup, tools.ytDlpPath);
      fs.rmSync(backup, { force: true });
      throw new Error(result.error || 'The update could not be verified; the previous version was restored.');
    }
    fs.rmSync(backup, { force: true });
    const version = await runVersion(tools.ytDlpPath, ['--version']);
    this.stateStore.write({
      ...this.stateStore.read({}),
      ytDlpVersion: version.version,
      updatedAt: new Date().toISOString()
    });
    return { ok: true, message: result.version || 'yt-dlp was updated.', version: version.version };
  }
}

module.exports = { ToolManager, sha256, hasPeHeader, runVersion, compareVersions };
