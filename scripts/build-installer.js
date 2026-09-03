'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const appSource = path.join(projectRoot, 'release', 'win-unpacked');
const output = path.join(projectRoot, 'release', `VideoAI-Downloader-${packageJson.version}-x64-Setup.exe`);
const script = path.join(projectRoot, 'build', 'installer.nsi');
const appExecutable = path.join(appSource, 'VideoAI Downloader.exe');

if (!fs.existsSync(appExecutable)) {
  throw new Error('The unpacked Windows application is missing. Run electron-builder --win dir --x64 first.');
}

function findCachedCompiler() {
  const cacheRoot = path.join(os.homedir(), '.cache', 'electron-builder');
  if (!fs.existsSync(cacheRoot)) return '';
  const bundles = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('nsis-'))
    .map((entry) => path.join(cacheRoot, entry.name));
  for (const bundle of bundles) {
    for (const name of fs.readdirSync(bundle)) {
      const root = path.join(bundle, name);
      const candidates = process.platform === 'win32'
        ? [path.join(root, 'makensis.exe'), path.join(root, 'Bin', 'makensis.exe')]
        : process.platform === 'darwin'
          ? [path.join(root, 'mac', 'makensis')]
          : [path.join(root, 'linux', 'makensis')];
      const match = candidates.find((candidate) => fs.existsSync(candidate));
      if (match) return match;
    }
  }
  return '';
}

const programFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || '';
const candidates = [
  process.env.MAKENSIS_PATH,
  findCachedCompiler(),
  programFiles ? path.join(programFiles, 'NSIS', 'makensis.exe') : '',
  process.platform === 'win32' ? 'makensis.exe' : 'makensis'
].filter(Boolean);

function directorySize(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directorySize(target);
    else if (entry.isFile()) total += fs.statSync(target).size;
  }
  return total;
}

const estimatedSize = Math.ceil(directorySize(appSource) / 1024);

fs.rmSync(output, { force: true });
const args = [
  '-V2',
  `-DAPP_SOURCE=${appSource}`,
  `-DOUTPUT_FILE=${output}`,
  `-DAPP_VERSION=${packageJson.version}`,
  `-DAPP_ICON=${path.join(projectRoot, 'build', 'icon.ico')}`,
  `-DLICENSE_FILE=${path.join(projectRoot, 'LICENSE')}`,
  `-DESTIMATED_SIZE=${estimatedSize}`,
  script
];

let lastError = '';
for (const compiler of candidates) {
  let compilerDirectory = path.dirname(path.resolve(compiler));
  for (let depth = 0; depth < 3 && !fs.existsSync(path.join(compilerDirectory, 'Stubs')); depth += 1) {
    compilerDirectory = path.dirname(compilerDirectory);
  }
  console.log(`Trying NSIS compiler: ${compiler}`);
  const hasBundledRuntime = fs.existsSync(path.join(compilerDirectory, 'Stubs'));
  const result = spawnSync(compiler, args, {
    cwd: hasBundledRuntime ? compilerDirectory : projectRoot,
    env: hasBundledRuntime ? { ...process.env, NSISDIR: compilerDirectory, PWD: compilerDirectory } : process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.status === 0 && fs.existsSync(output)) {
    const size = fs.statSync(output).size;
    if (size < 80 * 1024 * 1024) throw new Error(`Setup output is unexpectedly small: ${size} bytes.`);
    console.log(`Created ${path.basename(output)} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
    process.exit(0);
  }
  if (result.error?.code !== 'ENOENT') lastError = result.error?.message || `exit code ${result.status}`;
}

throw new Error(`NSIS compiler was not found or failed${lastError ? `: ${lastError}` : ''}. Install NSIS or set MAKENSIS_PATH.`);
