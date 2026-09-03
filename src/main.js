'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, clipboard, dialog, ipcMain, powerSaveBlocker, shell } = require('electron');
const { JsonStore } = require('./core/json-store');
const { sanitizeSettings, normalizeHttpUrl } = require('./core/validation');
const { ToolManager } = require('./core/tool-manager');
const { DownloadManager } = require('./core/download-manager');
const { inspectMedia } = require('./core/media-inspector');

let mainWindow = null;
let settings = null;
let settingsStore = null;
let toolManager = null;
let downloadManager = null;
let sleepBlockerId = null;
let isQuitting = false;

app.enableSandbox();

function appPaths() {
  const userData = app.getPath('userData');
  return {
    userData,
    settings: path.join(userData, 'settings.json'),
    jobs: path.join(userData, 'jobs.json'),
    archives: path.join(userData, 'archives'),
    bundledTools: app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(__dirname, '..', 'resources', 'toolchain')
  };
}

function refreshSleepBlocker(snapshot) {
  const shouldBlock = settings.preventSleep && snapshot.stats.active > 0;
  if (shouldBlock && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!shouldBlock && sleepBlockerId !== null) {
    if (powerSaveBlocker.isStarted(sleepBlockerId)) powerSaveBlocker.stop(sleepBlockerId);
    sleepBlockerId = null;
  }
}

function broadcastState(snapshot = downloadManager?.getSnapshot()) {
  if (!snapshot) return;
  refreshSleepBlocker(snapshot);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('downloads:state', snapshot);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e14',
    title: 'VideoAI Downloader',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (process.env.VIDEOAI_SMOKE_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(path.resolve(process.env.VIDEOAI_SMOKE_SCREENSHOT), image.toPNG());
          app.exit(0);
        } catch (error) {
          console.error(`UI smoke capture failed: ${error.message}`);
          app.exit(1);
        }
      }, 1_000);
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//iu.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function reply(handler) {
  return async (event, ...args) => {
    if (!event.senderFrame || !event.senderFrame.url.startsWith('file://')) {
      return { ok: false, error: 'Blocked an untrusted request.' };
    }
    try {
      return { ok: true, data: await handler(...args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unexpected application error.' };
    }
  };
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', reply(async () => ({
    version: app.getVersion(),
    platform: process.platform,
    settings,
    tools: toolManager.publicStatus(),
    downloads: downloadManager.getSnapshot()
  })));

  ipcMain.handle('dialog:choose-folder', reply(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose download folder',
      defaultPath: settings.downloadDirectory,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  }));

  ipcMain.handle('clipboard:read', reply(async () => clipboard.readText().slice(0, 4096)));
  ipcMain.handle('media:inspect', reply(async (request) => {
    const url = normalizeHttpUrl(request?.url);
    return inspectMedia({
      url,
      cookiesBrowser: request?.cookiesBrowser || settings.cookiesBrowser,
      tools: toolManager.getTools()
    });
  }));

  ipcMain.handle('downloads:add', reply(async (request) => {
    const tools = toolManager.getTools();
    if (!tools.ready) throw new Error(tools.error || 'Download components are unavailable.');
    return downloadManager.add(request);
  }));
  ipcMain.handle('downloads:action', reply(async ({ id, action }) => downloadManager.action(id, action)));
  ipcMain.handle('downloads:clear-finished', reply(async () => ({ removed: downloadManager.clearFinished() })));
  ipcMain.handle('downloads:log', reply(async (id) => downloadManager.getLog(id)));
  ipcMain.handle('downloads:open-folder', reply(async (id) => {
    const job = downloadManager.getJob(id);
    if (!job) throw new Error('Download job not found.');
    const error = await shell.openPath(job.outputDirectory);
    if (error) throw new Error(error);
    return true;
  }));
  ipcMain.handle('downloads:show-file', reply(async (id) => {
    const job = downloadManager.getJob(id);
    if (!job) throw new Error('Download job not found.');
    const filePath = job.outputFiles?.at(-1);
    if (filePath) shell.showItemInFolder(filePath);
    else {
      const error = await shell.openPath(job.outputDirectory);
      if (error) throw new Error(error);
    }
    return true;
  }));

  ipcMain.handle('settings:update', reply(async (patch) => {
    settings = sanitizeSettings({ ...settings, ...(patch || {}) }, { downloadDirectory: app.getPath('downloads') });
    settingsStore.write(settings);
    downloadManager.settingsChanged();
    return settings;
  }));
  ipcMain.handle('tools:check', reply(async () => toolManager.healthCheck()));
  ipcMain.handle('tools:update-ytdlp', reply(async () => toolManager.updateYtDlp()));
}

function initialize() {
  const paths = appPaths();
  settingsStore = new JsonStore(paths.settings);
  settings = sanitizeSettings(settingsStore.read({}), { downloadDirectory: app.getPath('downloads') });
  settingsStore.write(settings);

  toolManager = new ToolManager({
    bundledDirectory: paths.bundledTools,
    userDataDirectory: paths.userData
  });
  toolManager.initialize();

  downloadManager = new DownloadManager({
    jobsStore: new JsonStore(paths.jobs),
    archiveDirectory: paths.archives,
    getSettings: () => settings,
    getTools: () => toolManager.getTools()
  });
  downloadManager.on('state', broadcastState);
  registerIpc();
  createWindow();
  downloadManager.start();
}

const acquiredLock = app.requestSingleInstanceLock();
if (!acquiredLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.videoai.downloader');
    initialize();
  });
}

app.on('before-quit', () => {
  if (isQuitting) return;
  isQuitting = true;
  downloadManager?.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
