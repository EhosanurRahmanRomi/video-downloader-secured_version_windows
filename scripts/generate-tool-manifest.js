'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const binaryDirectory = path.join(projectRoot, 'resources', 'toolchain');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

function digest(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const filenames = fs.readdirSync(binaryDirectory)
  .filter((name) => /\.(?:exe|dll)$/iu.test(name))
  .sort((a, b) => a.localeCompare(b));

for (const required of ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe']) {
  if (!filenames.includes(required)) throw new Error(`Required tool is missing: ${required}`);
}

const manifest = {
  schemaVersion: 1,
  appVersion: packageJson.version,
  generatedAt: new Date().toISOString(),
  ytDlpVersion: process.env.VIDEOAI_YTDLP_VERSION || '2026.08.19',
  ffmpegVersion: process.env.VIDEOAI_FFMPEG_VERSION || 'N-126390-g9fc8c785e2-20260902',
  aria2Version: filenames.includes('aria2c.exe') ? (process.env.VIDEOAI_ARIA2_VERSION || '1.37.0') : '',
  files: Object.fromEntries(filenames.map((filename) => {
    const filePath = path.join(binaryDirectory, filename);
    return [filename, {
      sha256: digest(filePath),
      size: fs.statSync(filePath).size,
      required: filename !== 'aria2c.exe'
    }];
  }))
};

fs.writeFileSync(path.join(binaryDirectory, 'tools-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote manifest for ${filenames.length} toolchain files.`);
