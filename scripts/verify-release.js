'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const releaseDirectory = path.join(projectRoot, 'release');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const setupName = `VideoAI-Downloader-${packageJson.version}-x64-Setup.exe`;
const portableName = `VideoAI-Downloader-${packageJson.version}-x64-Portable.exe`;
const windowsArtifacts = [setupName, portableName];

for (const filename of windowsArtifacts) {
  const target = path.join(releaseDirectory, filename);
  if (!fs.existsSync(target)) throw new Error(`Windows build was not produced: ${filename}`);
  const stat = fs.statSync(target);
  if (stat.size < 80 * 1024 * 1024) throw new Error(`${filename} is unexpectedly small: ${stat.size} bytes`);
  const handle = fs.openSync(target, 'r');
  const header = Buffer.alloc(2);
  fs.readSync(handle, header, 0, 2, 0);
  fs.closeSync(handle);
  if (header.toString('ascii') !== 'MZ') throw new Error(`${filename} does not have a valid PE header.`);
  console.log(`Verified ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MiB)`);
}

const deliverables = [...windowsArtifacts, `VideoAI-Downloader-${packageJson.version}-Source.zip`]
  .filter((filename) => fs.existsSync(path.join(releaseDirectory, filename)));
const lines = deliverables.map((filename) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(path.join(releaseDirectory, filename)));
  return `${hash.digest('hex')}  ${filename}`;
});
fs.writeFileSync(path.join(releaseDirectory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
console.log(lines.join('\n'));
