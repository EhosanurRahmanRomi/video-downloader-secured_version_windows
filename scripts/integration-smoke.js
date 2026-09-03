'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { buildDownloadArgs } = require('../src/core/argument-builder');

const projectRoot = path.resolve(__dirname, '..');
const ytDlp = path.join(projectRoot, '.devtools', 'yt-dlp');
if (!fs.existsSync(ytDlp)) throw new Error('Download the official Unix yt-dlp zipapp to .devtools/yt-dlp first.');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-integration-'));
const source = path.join(temporary, 'sample.mp4');
const output = path.join(temporary, 'output');
fs.mkdirSync(output);

const ffmpeg = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
  '-t', '1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source
], { stdio: 'inherit' });
if (ffmpeg.status !== 0) throw new Error('Could not generate the local integration media fixture.');

const bytes = fs.readFileSync(source);
const server = http.createServer((request, response) => {
  if (request.url !== '/sample.mp4') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length });
  response.end(bytes);
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function run(executable, args) {
  return new Promise((resolve) => {
    let stdout = ''; let stderr = '';
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

(async () => {
  try {
    await listen();
    const address = server.address();
    const job = {
      url: `http://127.0.0.1:${address.port}/sample.mp4`,
      outputDirectory: output,
      archivePath: path.join(temporary, 'archive.txt'),
      mediaKind: 'video', quality: '720', videoContainer: 'mp4', audioFormat: 'mp3',
      playlistMode: 'single', playlistItems: '', overwrite: false, embedMetadata: true,
      embedThumbnail: false, includeSubtitles: false, includeAutoSubtitles: false,
      removeSponsorSegments: false, cookiesBrowser: 'none'
    };
    const settings = { retryCount: 2, socketTimeout: 10, fragmentConcurrency: 4, useAria2: false, ariaConnections: 4 };
    const result = await run(ytDlp, buildDownloadArgs(job, settings, {
      ready: true, ffmpegDirectory: '/usr/bin', aria2Available: false, binDirectory: '/usr/bin'
    }));
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const combined = `${result.stdout}\n${result.stderr}`;
    assert.match(combined, /__VAI_ITEM__/u);
    assert.match(combined, /__VAI_PROGRESS__/u);
    assert.match(combined, /__VAI_FILE__/u);
    const files = fs.readdirSync(output).filter((name) => name.endsWith('.mp4'));
    assert.equal(files.length, 1);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1', path.join(output, files[0])], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.match(probe.stdout, /duration=1\.[0-9]+/u);
    console.log(`Integration smoke passed: ${files[0]}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
