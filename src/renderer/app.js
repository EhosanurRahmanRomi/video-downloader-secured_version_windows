'use strict';

const ACTIVE_STATUSES = new Set(['starting', 'downloading', 'processing', 'pausing', 'cancelling']);
const PLAYLIST_PAGE_SIZE = 100;
const state = {
  version: '',
  settings: null,
  tools: null,
  downloads: { jobs: [], stats: { total: 0, active: 0, queued: 0, completed: 0, failed: 0, combinedSpeed: 0 } },
  inspection: null,
  inspectedUrl: '',
  playlistSelection: new Set(),
  playlistQuery: '',
  playlistVisibleLimit: PLAYLIST_PAGE_SIZE,
  currentView: 'new',
  currentFilter: 'all'
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function unwrap(promise) {
  const result = await promise;
  if (!result?.ok) throw new Error(result?.error || 'The request could not be completed.');
  return result.data;
}

function formatBytes(value, suffix = '') {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return `0 B${suffix}`;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const amount = bytes / (1024 ** index);
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}${suffix}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return '';
  }
}

function toast(message, kind = 'success') {
  const region = $('#toast-region');
  const item = element('div', `toast ${kind}`);
  item.append(element('span', 'toast-dot'), element('span', '', message));
  region.append(item);
  setTimeout(() => item.remove(), 4_200);
}

function setLoading(button, loading, label) {
  if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
  button.disabled = loading;
  button.classList.toggle('loading', loading);
  button.textContent = loading ? label : button.dataset.originalLabel;
}

function setFormSubmitLoading(loading) {
  const button = $('#add-download-button');
  const label = button.querySelector('span:last-child');
  button.disabled = loading || !state.tools?.ready;
  button.classList.toggle('loading', loading);
  if (label) label.textContent = loading ? 'Adding to queue…' : submitButtonLabel();
}

function setUrlError(message = '') {
  const node = $('#url-error');
  node.textContent = message;
  node.classList.toggle('hidden', !message);
  $('#media-url').setAttribute('aria-invalid', message ? 'true' : 'false');
}

function renderEngineStatus() {
  const status = $('#engine-status');
  const text = $('#engine-status-text');
  const alert = $('#tool-alert');
  status.classList.remove('ready', 'error');
  if (state.tools?.ready) {
    status.classList.add('ready');
    text.textContent = state.tools.aria2Available ? 'High-speed engine ready' : 'Download engine ready';
    alert.classList.add('hidden');
  } else {
    status.classList.add('error');
    text.textContent = 'Engine needs attention';
    $('#tool-alert-text').textContent = state.tools?.error || 'Required components are unavailable.';
    alert.classList.remove('hidden');
  }
  $('#add-download-button').disabled = !state.tools?.ready;
  renderComponentStatus(state.tools);
}

function renderStats() {
  const stats = state.downloads.stats;
  $('#stat-active').textContent = stats.active;
  $('#stat-queued').textContent = stats.queued;
  $('#stat-completed').textContent = stats.completed;
  $('#stat-speed').textContent = `${formatBytes(stats.combinedSpeed, '/s')} combined`;
  $('#stat-fragments').textContent = `${state.settings.fragmentConcurrency}×`;
  $('#stat-acceleration').textContent = 'fragments per video';
  $('#fact-jobs').textContent = state.settings.maxConcurrentDownloads;
  $('#fact-fragments').textContent = state.settings.fragmentConcurrency;
  $('#fact-aria').textContent = state.settings.useAria2 && state.tools?.aria2Available ? state.settings.ariaConnections : 'Off';
  const unfinished = state.downloads.jobs.filter((job) => !['completed', 'cancelled', 'failed'].includes(job.status)).length;
  $('#queue-count').textContent = unfinished;
  $('#filter-count-all').textContent = stats.total;
  $('#filter-count-active').textContent = state.downloads.jobs.filter((job) => ACTIVE_STATUSES.has(job.status) || ['queued', 'paused'].includes(job.status)).length;
  $('#filter-count-completed').textContent = stats.completed;
  $('#filter-count-failed').textContent = stats.failed;
}

function statusLabel(status) {
  return ({
    queued: 'Queued', starting: 'Starting', downloading: 'Downloading', processing: 'Processing',
    pausing: 'Pausing', paused: 'Paused', completed: 'Completed', failed: 'Needs attention',
    cancelling: 'Cancelling', cancelled: 'Cancelled'
  })[status] || status;
}

function jobTitle(job) {
  return job.title || job.currentItem || (() => {
    try { return new URL(job.url).hostname; } catch { return 'Untitled download'; }
  })();
}

function jobFormat(job) {
  if (job.mediaKind === 'audio') return job.audioFormat.toUpperCase();
  const quality = job.quality === 'best' ? 'Best quality' : `${job.quality}p`;
  return `${quality} · ${job.videoContainer.toUpperCase()}`;
}

function createThumbnail(job, compact = false) {
  const holder = element('div', compact ? 'recent-item-icon' : 'job-thumb');
  if (job.thumbnail) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = job.thumbnail;
    image.addEventListener('error', () => {
      image.remove();
      holder.textContent = job.mediaKind === 'audio' ? '♪' : '▶';
    }, { once: true });
    holder.append(image);
  } else {
    holder.textContent = job.mediaKind === 'audio' ? '♪' : '▶';
  }
  return holder;
}

function createJobButton(label, action, jobId, style = '') {
  const button = element('button', `job-action ${style}`.trim(), label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.jobId = jobId;
  return button;
}

function actionsFor(job) {
  const actions = [];
  if (['queued', 'starting', 'downloading', 'processing'].includes(job.status)) {
    actions.push(['Pause', 'pause', 'primary-action'], ['Cancel', 'cancel', 'danger']);
  } else if (job.status === 'paused') {
    actions.push(['Resume', 'resume', 'primary-action'], ['Cancel', 'cancel', 'danger'], ['Remove', 'remove', '']);
  } else if (job.status === 'failed') {
    actions.push(['Retry', 'retry', 'primary-action'], ['View log', 'log', ''], ['Remove', 'remove', 'danger']);
  } else if (job.status === 'completed') {
    actions.push(['Show file', 'show-file', 'primary-action'], ['Open folder', 'open-folder', ''], ['View log', 'log', ''], ['Remove', 'remove', '']);
  } else if (job.status === 'cancelled') {
    actions.push(['Retry', 'retry', 'primary-action'], ['Open folder', 'open-folder', ''], ['Remove', 'remove', '']);
  }
  if (!['completed', 'cancelled'].includes(job.status) && !actions.some(([_, action]) => action === 'open-folder')) {
    actions.push(['Open folder', 'open-folder', '']);
  }
  return actions;
}

function createJobCard(job) {
  const card = element('article', `job-card ${job.status}`);
  const top = element('div', 'job-top');
  const copy = element('div', 'job-copy');
  copy.append(element('strong', 'job-title', jobTitle(job)));
  const meta = element('div', 'job-meta');
  meta.append(element('span', '', jobFormat(job)));
  const scopeLabel = job.playlistMode === 'single'
    ? 'Single item'
    : job.playlistMode === 'playlist' && job.selectedItemCount
      ? `${job.selectedItemCount} selected`
      : job.playlistMode === 'playlist' ? 'Playlist' : 'Auto detect';
  meta.append(element('span', '', scopeLabel));
  meta.append(element('span', '', formatDate(job.createdAt)));
  copy.append(meta);
  const badge = element('span', `status-badge status-${job.status}`, statusLabel(job.status));
  top.append(createThumbnail(job), copy, badge);
  card.append(top);

  const message = element('div', `job-message ${job.status === 'failed' ? 'error' : ''}`, job.error || job.lastMessage || 'Waiting…');
  card.append(message);
  const track = element('div', 'progress-track');
  const fill = element('div', 'progress-fill');
  fill.style.width = `${Math.min(100, Math.max(0, Number(job.progress) || 0))}%`;
  track.append(fill);
  card.append(track);

  const progressRow = element('div', 'job-progress-row');
  const left = element('span');
  const percent = element('strong', '', `${Math.round(Number(job.progress) || 0)}%`);
  const detailParts = [];
  if (job.speed || job.speedText) detailParts.push(job.speedText || formatBytes(job.speed, '/s'));
  if (job.eta || job.etaText) detailParts.push(`ETA ${job.etaText || formatDuration(job.eta)}`);
  left.append(percent, document.createTextNode(detailParts.length ? ` · ${detailParts.join(' · ')}` : ''));
  const rightText = job.itemCount > 1 && job.currentItemIndex
    ? `Item ${job.currentItemIndex} / ${job.itemCount}`
    : job.outputFiles?.length
      ? `${job.outputFiles.length} file${job.outputFiles.length === 1 ? '' : 's'}`
      : job.itemCount > 1 ? `${job.itemCount} items selected` : '';
  const right = element('span', '', rightText);
  progressRow.append(left, right);
  card.append(progressRow);

  const actionRow = element('div', 'job-actions');
  for (const [label, action, style] of actionsFor(job)) actionRow.append(createJobButton(label, action, job.id, style));
  card.append(actionRow);
  return card;
}

function filteredJobs() {
  const jobs = state.downloads.jobs;
  if (state.currentFilter === 'active') return jobs.filter((job) => ACTIVE_STATUSES.has(job.status) || ['queued', 'paused'].includes(job.status));
  if (state.currentFilter === 'completed') return jobs.filter((job) => job.status === 'completed');
  if (state.currentFilter === 'failed') return jobs.filter((job) => job.status === 'failed');
  return jobs;
}

function renderJobs() {
  const list = $('#jobs-list');
  list.replaceChildren();
  const jobs = filteredJobs();
  const fragment = document.createDocumentFragment();
  for (const job of jobs) fragment.append(createJobCard(job));
  list.append(fragment);
  $('#queue-empty').classList.toggle('hidden', jobs.length > 0);

  const recent = $('#recent-jobs');
  recent.replaceChildren();
  for (const job of state.downloads.jobs.slice(0, 4)) {
    const item = element('div', 'recent-item');
    const copy = element('div', 'recent-item-copy');
    copy.append(element('strong', '', jobTitle(job)), element('span', '', `${statusLabel(job.status)} · ${jobFormat(job)}`));
    item.append(createThumbnail(job, true), copy, element('span', 'recent-percent', `${Math.round(Number(job.progress) || 0)}%`));
    recent.append(item);
  }
  $('#recent-empty').classList.toggle('hidden', state.downloads.jobs.length > 0);
}

function renderAll() {
  renderEngineStatus();
  renderStats();
  renderJobs();
}

function switchView(view) {
  state.currentView = view;
  $$('.view').forEach((node) => node.classList.toggle('active', node.id === `view-${view}`));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#view-eyebrow').textContent = view === 'new' ? 'DOWNLOAD CENTER' : 'QUEUE & HISTORY';
  $('#view-title').textContent = view === 'new' ? 'Save media. Skip the waiting.' : 'Every download, under control.';
}

function playlistMode() {
  return $$('input[name="playlist-mode"]').find((input) => input.checked)?.value
    || $('input[name="playlist-mode"]:checked')?.value
    || 'auto';
}

function currentPlaylistEntries() {
  return Array.isArray(state.inspection?.entries) ? state.inspection.entries : [];
}

function submitButtonLabel() {
  if (playlistMode() === 'playlist' && state.inspection?.isPlaylist) {
    const count = state.playlistSelection.size;
    return count ? `Add ${count} selected video${count === 1 ? '' : 's'} to queue` : 'Select playlist videos to continue';
  }
  return 'Add to download queue';
}

function resetInspection() {
  state.inspection = null;
  state.inspectedUrl = '';
  state.playlistSelection.clear();
  state.playlistQuery = '';
  state.playlistVisibleLimit = PLAYLIST_PAGE_SIZE;
  $('#playlist-search').value = '';
  setPlaylistError('');
  renderInspection();
}

function setPlaylistError(message = '') {
  const node = $('#playlist-selection-error');
  node.textContent = message;
  node.classList.toggle('hidden', !message);
}

function entryAvailabilityLabel(entry) {
  if (!entry.selectable) return 'Unavailable';
  const value = String(entry.availability || '').replaceAll('_', ' ').trim();
  if (!value || ['public', 'unlisted', 'not live'].includes(value.toLowerCase())) return '';
  return value;
}

function createPlaylistItem(entry) {
  const selected = state.playlistSelection.has(entry.index);
  const row = element('label', `playlist-item${selected ? ' selected' : ''}${entry.selectable ? '' : ' unavailable'}`);
  row.setAttribute('role', 'listitem');

  const checkbox = document.createElement('input');
  checkbox.className = 'playlist-checkbox';
  checkbox.type = 'checkbox';
  checkbox.checked = selected;
  checkbox.disabled = !entry.selectable;
  checkbox.dataset.playlistIndex = String(entry.index);
  checkbox.setAttribute('aria-label', `Select playlist video ${entry.index}: ${entry.title}`);

  const index = element('span', 'playlist-index', `#${entry.index}`);
  const thumb = element('span', 'playlist-thumb', '▶');
  if (entry.thumbnail) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = entry.thumbnail;
    image.addEventListener('error', () => image.remove(), { once: true });
    thumb.append(image);
  }

  const copy = element('span', 'playlist-item-copy');
  copy.append(element('strong', 'playlist-item-title', entry.title));
  const meta = element('span', 'playlist-item-meta');
  if (entry.sourceLabel) meta.append(element('span', '', entry.sourceLabel));
  const availability = entryAvailabilityLabel(entry);
  if (availability) meta.append(element('span', 'availability-label', availability));
  if (!meta.childNodes.length) meta.append(element('span', '', entry.selectable ? 'Ready to download' : 'This item cannot be downloaded'));
  copy.append(meta);

  row.append(checkbox, index, thumb, copy, element('span', 'playlist-duration', entry.duration ? formatDuration(entry.duration) : '—'));
  return row;
}

function filteredPlaylistEntries() {
  const entries = currentPlaylistEntries();
  const query = state.playlistQuery.trim().toLocaleLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => `${entry.index} ${entry.title} ${entry.sourceLabel} ${entry.availability}`.toLocaleLowerCase().includes(query));
}

function renderPlaylistBrowser() {
  const browser = $('#playlist-browser');
  const info = state.inspection;
  const visible = Boolean(info?.isPlaylist && playlistMode() !== 'single');
  browser.classList.toggle('hidden', !visible);
  if (!visible) {
    $('#add-download-button').querySelector('span:last-child').textContent = submitButtonLabel();
    return;
  }

  const entries = currentPlaylistEntries();
  const selectedEntries = entries.filter((entry) => state.playlistSelection.has(entry.index));
  const selectedDuration = selectedEntries.reduce((total, entry) => total + (Number(entry.duration) || 0), 0);
  const selectedWithDuration = selectedEntries.filter((entry) => Number(entry.duration) > 0).length;
  const unavailableCount = entries.filter((entry) => !entry.selectable).length;
  const totalCount = Math.max(Number(info.playlistCount) || 0, entries.length);

  $('#playlist-total').textContent = String(totalCount);
  $('#playlist-selected').textContent = String(state.playlistSelection.size);
  $('#playlist-duration').textContent = selectedWithDuration ? formatDuration(selectedDuration) : '—';
  $('#playlist-unavailable').textContent = String(unavailableCount);
  const badge = $('#playlist-selection-badge');
  badge.textContent = `${state.playlistSelection.size} selected`;
  badge.classList.toggle('empty', state.playlistSelection.size === 0);

  const filtered = filteredPlaylistEntries();
  const shown = filtered.slice(0, state.playlistVisibleLimit);
  const list = $('#playlist-list');
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const entry of shown) fragment.append(createPlaylistItem(entry));
  list.append(fragment);

  const empty = $('#playlist-empty');
  empty.textContent = entries.length ? 'No videos match this search.' : 'This website did not return individual playlist items.';
  empty.classList.toggle('hidden', shown.length > 0);
  $('#playlist-showing').textContent = state.playlistQuery
    ? `Showing ${shown.length} of ${filtered.length} matches · ${entries.length} total`
    : `Showing ${shown.length} of ${entries.length} videos`;
  $('#playlist-load-more').classList.toggle('hidden', shown.length >= filtered.length);
  $('#add-download-button').querySelector('span:last-child').textContent = submitButtonLabel();
}

function initializePlaylistSelection(info, url) {
  state.inspection = info;
  state.inspectedUrl = url;
  state.playlistSelection = new Set(
    (Array.isArray(info.entries) ? info.entries : [])
      .filter((entry) => entry.selectable !== false)
      .map((entry) => Number(entry.index))
      .filter((index) => Number.isSafeInteger(index) && index > 0)
  );
  state.playlistQuery = '';
  state.playlistVisibleLimit = PLAYLIST_PAGE_SIZE;
  $('#playlist-search').value = '';
  setPlaylistError('');
}

function renderInspection() {
  const preview = $('#media-preview');
  const info = state.inspection;
  preview.classList.toggle('hidden', !info);
  if (!info) {
    renderPlaylistBrowser();
    return;
  }
  $('#preview-title').textContent = info.title;
  $('#preview-type').textContent = info.isPlaylist ? 'PLAYLIST' : 'VIDEO';
  const details = [];
  if (info.sourceLabel) details.push(info.sourceLabel);
  if (info.isPlaylist && info.playlistCount) details.push(`${info.playlistCount} items`);
  else if (info.duration) details.push(formatDuration(info.duration));
  $('#preview-meta').textContent = details.join(' · ') || info.extractor || 'Ready to download';
  const image = $('#preview-thumb');
  image.classList.toggle('hidden', !info.thumbnail);
  $('#preview-placeholder').classList.toggle('hidden', Boolean(info.thumbnail));
  if (info.thumbnail) image.src = info.thumbnail;
  renderPlaylistBrowser();
}

function setMediaKind(kind) {
  const audio = kind === 'audio';
  $('#quality-select').closest('div').classList.toggle('hidden', audio);
  $('#video-container-field').classList.toggle('hidden', audio);
  $('#audio-format-field').classList.toggle('hidden', !audio);
}

function setPlaylistMode(mode) {
  $('#playlist-mode-hint').textContent = mode === 'single'
    ? 'Only the linked video will be saved, even if the URL belongs to a playlist.'
    : mode === 'playlist'
      ? 'Analyze the URL to browse every video and make an exact selection.'
      : 'Auto detects whether the link is a video or playlist.';
  setPlaylistError('');
  renderPlaylistBrowser();
}

function applySettingsToForm() {
  const settings = state.settings;
  $('#output-directory').value = settings.downloadDirectory;
  $(`input[name="media-kind"][value="${settings.defaultMediaKind}"]`).checked = true;
  $('#quality-select').value = settings.defaultQuality;
  $('#video-container').value = settings.defaultVideoContainer;
  $('#audio-format').value = settings.defaultAudioFormat;
  $('#embed-metadata').checked = settings.embedMetadata;
  $('#embed-thumbnail').checked = settings.embedThumbnail;
  $('#cookies-browser').value = settings.cookiesBrowser;
  setMediaKind(settings.defaultMediaKind);
  setPlaylistMode(playlistMode());
}

function populateSettingsDialog() {
  $('#setting-max-jobs').value = state.settings.maxConcurrentDownloads;
  $('#setting-fragments').value = state.settings.fragmentConcurrency;
  $('#setting-aria-connections').value = state.settings.ariaConnections;
  $('#setting-use-aria').checked = state.settings.useAria2;
  $('#setting-retries').value = state.settings.retryCount;
  $('#setting-timeout').value = state.settings.socketTimeout;
  $('#setting-prevent-sleep').checked = state.settings.preventSleep;
  updateRangeOutputs();
  renderComponentStatus(state.tools);
}

function updateRangeOutputs() {
  $('#setting-max-jobs-value').textContent = $('#setting-max-jobs').value;
  $('#setting-fragments-value').textContent = $('#setting-fragments').value;
  $('#setting-aria-value').textContent = $('#setting-aria-connections').value;
  $('#aria-range-field').classList.toggle('hidden', !$('#setting-use-aria').checked);
}

function renderComponentStatus(tools) {
  if (!tools) return;
  const badge = $('#component-badge');
  badge.classList.toggle('error', !tools.ready);
  badge.textContent = tools.ready ? 'READY' : 'ATTENTION';
  $('#component-summary').textContent = tools.ready
    ? `yt-dlp and FFmpeg are verified${tools.aria2Available ? '; aria2 acceleration is available.' : '.'}`
    : tools.error || 'Required components are unavailable.';
  const versions = tools.versions || {};
  $('#component-versions').textContent = [
    versions.ytDlp ? `yt-dlp ${versions.ytDlp}` : '',
    versions.ffmpeg ? `FFmpeg ${versions.ffmpeg}` : '',
    versions.aria2 ? `aria2 ${versions.aria2}` : ''
  ].filter(Boolean).join('  ·  ');
  $('#update-ytdlp-button').disabled = !tools.ready || state.platform !== 'win32';
}

async function analyzeUrl() {
  const url = $('#media-url').value.trim();
  if (!url) {
    setUrlError('Paste a URL before analyzing it.');
    return;
  }
  setUrlError('');
  const button = $('#analyze-button');
  setLoading(button, true, 'Analyzing');
  try {
    const info = await unwrap(window.videoAI.inspectMedia({ url, cookiesBrowser: $('#cookies-browser').value }));
    if ($('#media-url').value.trim() !== url) return null;
    initializePlaylistSelection(info, url);
    if (info.isPlaylist) {
      $$('input[name="playlist-mode"]').forEach((input) => { input.checked = input.value === 'playlist'; });
      setPlaylistMode('playlist');
    }
    renderInspection();
    if (info.isPlaylist) {
      toast(`Loaded ${info.entries?.length || 0} playlist videos. Review the selection below.`, 'info');
    }
    return info;
  } catch (error) {
    setUrlError(error.message);
    return null;
  } finally {
    setLoading(button, false, 'Analyzing');
  }
}

function collectRequest() {
  const request = {
    url: $('#media-url').value,
    outputDirectory: $('#output-directory').value,
    mediaKind: $('input[name="media-kind"]:checked').value,
    playlistMode: playlistMode(),
    quality: $('#quality-select').value,
    videoContainer: $('#video-container').value,
    audioFormat: $('#audio-format').value,
    embedMetadata: $('#embed-metadata').checked,
    embedThumbnail: $('#embed-thumbnail').checked,
    includeSubtitles: $('#include-subtitles').checked,
    includeAutoSubtitles: $('#auto-subtitles').checked,
    removeSponsorSegments: $('#sponsorblock').checked,
    overwrite: $('#overwrite-files').checked,
    cookiesBrowser: $('#cookies-browser').value,
    title: state.inspection?.title || '',
    thumbnail: state.inspection?.thumbnail || '',
    sourceLabel: state.inspection?.sourceLabel || ''
  };
  if (request.playlistMode === 'playlist' && state.inspection?.isPlaylist && state.inspectedUrl === request.url.trim()) {
    request.selectedPlaylistItems = [...state.playlistSelection].sort((left, right) => left - right);
  }
  return request;
}

async function submitDownload(event) {
  event.preventDefault();
  setUrlError('');
  if (!$('#media-url').value.trim()) {
    setUrlError('Paste a video or playlist URL first.');
    $('#media-url').focus();
    return;
  }
  const url = $('#media-url').value.trim();
  if (playlistMode() === 'playlist' && (!state.inspection?.isPlaylist || state.inspectedUrl !== url)) {
    const info = await analyzeUrl();
    if (info?.isPlaylist) {
      toast('Playlist loaded. Choose the videos you want, then add them to the queue.', 'info');
      return;
    }
  }
  if (playlistMode() === 'playlist' && state.inspection?.isPlaylist && state.playlistSelection.size === 0) {
    setPlaylistError('Select at least one playlist video before adding this download.');
    $('#playlist-browser').scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  setFormSubmitLoading(true);
  try {
    const selectedCount = playlistMode() === 'playlist' && state.inspection?.isPlaylist ? state.playlistSelection.size : 0;
    await unwrap(window.videoAI.addDownload(collectRequest()));
    toast(selectedCount ? `Added ${selectedCount} selected videos to the queue.` : 'Added to the download queue.');
    $('#media-url').value = '';
    resetInspection();
  } catch (error) {
    setUrlError(error.message);
  } finally {
    setFormSubmitLoading(false);
  }
}

async function handleJobAction(button) {
  const { action, jobId } = button.dataset;
  button.disabled = true;
  try {
    if (action === 'open-folder') {
      await unwrap(window.videoAI.openJobFolder(jobId));
    } else if (action === 'show-file') {
      await unwrap(window.videoAI.showJobFile(jobId));
    } else if (action === 'log') {
      const log = await unwrap(window.videoAI.getJobLog(jobId));
      $('#log-title').textContent = log.title;
      $('#log-error').textContent = log.error || '';
      $('#log-error').classList.toggle('hidden', !log.error);
      $('#log-content').textContent = log.entries.length
        ? log.entries.map((entry) => `[${entry.at}] ${entry.level.toUpperCase()}  ${entry.message}`).join('\n')
        : 'No diagnostic messages were recorded for this job.';
      $('#log-dialog').showModal();
    } else {
      await unwrap(window.videoAI.jobAction({ id: jobId, action }));
      if (action === 'remove') toast('Download removed from history.', 'info');
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function checkComponents() {
  const buttons = [$('#check-components-button'), $('#tool-alert-check')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const tools = await unwrap(window.videoAI.checkTools());
    state.tools = tools;
    renderEngineStatus();
    toast(tools.ready ? 'All required components passed.' : tools.error, tools.ready ? 'success' : 'error');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function bindEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-view-target]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewTarget)));
  $('#settings-button').addEventListener('click', () => { populateSettingsDialog(); $('#settings-dialog').showModal(); });
  $('#mobile-settings-button').addEventListener('click', () => { populateSettingsDialog(); $('#settings-dialog').showModal(); });
  $('#tune-speed-button').addEventListener('click', () => { populateSettingsDialog(); $('#settings-dialog').showModal(); });
  $('#download-form').addEventListener('submit', submitDownload);
  $('#analyze-button').addEventListener('click', analyzeUrl);
  $('#paste-button').addEventListener('click', async () => {
    try {
      $('#media-url').value = await unwrap(window.videoAI.readClipboard());
      resetInspection();
      setUrlError('');
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#media-url').addEventListener('input', () => { resetInspection(); setUrlError(''); });
  $('#media-url').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void analyzeUrl();
  });
  $('#clear-preview').addEventListener('click', resetInspection);
  $$('input[name="media-kind"]').forEach((input) => input.addEventListener('change', () => setMediaKind(input.value)));
  $$('input[name="playlist-mode"]').forEach((input) => input.addEventListener('change', () => setPlaylistMode(input.value)));
  $('#playlist-search').addEventListener('input', (event) => {
    state.playlistQuery = event.target.value;
    state.playlistVisibleLimit = PLAYLIST_PAGE_SIZE;
    renderPlaylistBrowser();
  });
  $('#playlist-list').addEventListener('change', (event) => {
    const checkbox = event.target.closest?.('[data-playlist-index]');
    if (!checkbox) return;
    const index = Number(checkbox.dataset.playlistIndex);
    if (checkbox.checked) state.playlistSelection.add(index);
    else state.playlistSelection.delete(index);
    setPlaylistError('');
    renderPlaylistBrowser();
  });
  $('#playlist-select-all').addEventListener('click', () => {
    state.playlistSelection = new Set(currentPlaylistEntries().filter((entry) => entry.selectable).map((entry) => entry.index));
    setPlaylistError('');
    renderPlaylistBrowser();
  });
  $('#playlist-clear').addEventListener('click', () => {
    state.playlistSelection.clear();
    renderPlaylistBrowser();
  });
  $('#playlist-invert').addEventListener('click', () => {
    const next = new Set();
    for (const entry of currentPlaylistEntries()) {
      if (entry.selectable && !state.playlistSelection.has(entry.index)) next.add(entry.index);
    }
    state.playlistSelection = next;
    setPlaylistError('');
    renderPlaylistBrowser();
  });
  $('#playlist-load-more').addEventListener('click', () => {
    state.playlistVisibleLimit += PLAYLIST_PAGE_SIZE;
    renderPlaylistBrowser();
  });
  $('#choose-folder-button').addEventListener('click', async () => {
    try {
      const folder = await unwrap(window.videoAI.chooseFolder());
      if (folder) $('#output-directory').value = folder;
    } catch (error) { toast(error.message, 'error'); }
  });

  $$('.filter-tab').forEach((button) => button.addEventListener('click', () => {
    state.currentFilter = button.dataset.filter;
    $$('.filter-tab').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
    renderJobs();
  }));
  $('#jobs-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action][data-job-id]');
    if (button) void handleJobAction(button);
  });
  $('#clear-finished-button').addEventListener('click', async () => {
    try {
      const result = await unwrap(window.videoAI.clearFinished());
      toast(result.removed ? `Removed ${result.removed} finished job${result.removed === 1 ? '' : 's'}.` : 'There are no finished jobs to clear.', 'info');
    } catch (error) { toast(error.message, 'error'); }
  });

  ['setting-max-jobs', 'setting-fragments', 'setting-aria-connections'].forEach((id) => $(`#${id}`).addEventListener('input', updateRangeOutputs));
  $('#setting-use-aria').addEventListener('change', updateRangeOutputs);
  $('#settings-form').addEventListener('submit', async (event) => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const saveButton = $('#save-settings-button');
    saveButton.disabled = true;
    try {
      state.settings = await unwrap(window.videoAI.updateSettings({
        maxConcurrentDownloads: Number($('#setting-max-jobs').value),
        fragmentConcurrency: Number($('#setting-fragments').value),
        ariaConnections: Number($('#setting-aria-connections').value),
        useAria2: $('#setting-use-aria').checked,
        retryCount: Number($('#setting-retries').value),
        socketTimeout: Number($('#setting-timeout').value),
        preventSleep: $('#setting-prevent-sleep').checked
      }));
      $('#settings-dialog').close();
      renderAll();
      toast('Settings saved. New jobs will use them.');
    } catch (error) { toast(error.message, 'error'); }
    finally { saveButton.disabled = false; }
  });
  $('#check-components-button').addEventListener('click', checkComponents);
  $('#tool-alert-check').addEventListener('click', checkComponents);
  $('#update-ytdlp-button').addEventListener('click', async () => {
    const button = $('#update-ytdlp-button');
    setLoading(button, true, 'Updating');
    try {
      const result = await unwrap(window.videoAI.updateYtDlp());
      toast(result.message || `yt-dlp updated to ${result.version}.`);
      state.tools = await unwrap(window.videoAI.checkTools());
      renderEngineStatus();
    } catch (error) { toast(error.message, 'error'); }
    finally { setLoading(button, false, 'Updating'); }
  });
}

async function initialize() {
  bindEvents();
  try {
    const bootstrap = await unwrap(window.videoAI.bootstrap());
    state.version = bootstrap.version;
    state.platform = bootstrap.platform;
    state.settings = bootstrap.settings;
    state.tools = bootstrap.tools;
    state.downloads = bootstrap.downloads;
    $('#app-version').textContent = `Version ${state.version}`;
    applySettingsToForm();
    renderAll();
    window.videoAI.onDownloadState((downloads) => {
      state.downloads = downloads;
      renderStats();
      renderJobs();
    });
  } catch (error) {
    toast(`VideoAI Downloader could not initialize: ${error.message}`, 'error');
  }
}

void initialize();
