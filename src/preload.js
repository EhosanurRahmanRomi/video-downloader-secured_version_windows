'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('videoAI', Object.freeze({
  bootstrap: () => invoke('app:bootstrap'),
  chooseFolder: () => invoke('dialog:choose-folder'),
  readClipboard: () => invoke('clipboard:read'),
  inspectMedia: (request) => invoke('media:inspect', request),
  addDownload: (request) => invoke('downloads:add', request),
  jobAction: (request) => invoke('downloads:action', request),
  clearFinished: () => invoke('downloads:clear-finished'),
  getJobLog: (id) => invoke('downloads:log', id),
  openJobFolder: (id) => invoke('downloads:open-folder', id),
  showJobFile: (id) => invoke('downloads:show-file', id),
  updateSettings: (patch) => invoke('settings:update', patch),
  checkTools: () => invoke('tools:check'),
  updateYtDlp: () => invoke('tools:update-ytdlp'),
  onDownloadState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('downloads:state', listener);
    return () => ipcRenderer.removeListener('downloads:state', listener);
  }
}));
