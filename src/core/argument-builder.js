'use strict';

const path = require('node:path');

function videoFormatSelector(quality, container) {
  const height = quality === 'best' ? '' : `[height<=${quality}]`;
  if (container === 'mp4') {
    const preferred = `bv*${height}[ext=mp4]+ba[ext=m4a]/b${height}[ext=mp4]/bv*${height}+ba/b${height}`;
    return height ? `${preferred}/b[ext=mp4]/b` : preferred;
  }
  if (container === 'webm') {
    const preferred = `bv*${height}[ext=webm]+ba[ext=webm]/b${height}[ext=webm]/bv*${height}+ba/b${height}`;
    return height ? `${preferred}/b[ext=webm]/b` : preferred;
  }
  return height ? `bv*${height}+ba/b${height}/b` : 'bv*+ba/b';
}

function outputTemplate(job) {
  const filename = '%(title).180B [%(id)s].%(ext)s';
  return job.playlistMode === 'playlist'
    ? '%(playlist_title|Playlist).120B/%(playlist_index)03d - ' + filename
    : '%(playlist_index&{} - |)s' + filename;
}

function buildDownloadArgs(job, settings, tools) {
  const args = [
    '--ignore-config',
    '--newline',
    '--no-color',
    '--progress',
    '--progress-delta', '0.25',
    '--progress-template', 'download:__VAI_PROGRESS__%(progress)j',
    '--print', 'before_dl:__VAI_ITEM__{"id":%(id)j,"title":%(title)j,"playlist_index":%(playlist_index)j,"playlist_autonumber":%(playlist_autonumber)j,"playlist_count":%(playlist_count)j,"n_entries":%(n_entries)j}',
    '--print', 'after_move:__VAI_FILE__%(filepath)j',
    '--continue',
    '--part',
    '--retries', String(settings.retryCount),
    '--fragment-retries', String(settings.retryCount),
    '--retry-sleep', 'fragment:exp=1:20',
    '--file-access-retries', '5',
    '--socket-timeout', String(settings.socketTimeout),
    '--concurrent-fragments', String(settings.fragmentConcurrency),
    '--windows-filenames',
    '--trim-filenames', '220',
    '--paths', `home:${job.outputDirectory}`,
    '--output', outputTemplate(job),
    '--download-archive', job.archivePath
  ];

  if (tools.ffmpegDirectory) {
    args.push('--ffmpeg-location', tools.ffmpegDirectory);
  }

  if (settings.useAria2 && tools.aria2Available) {
    args.push(
      '--downloader', 'http,ftp:aria2c',
      '--downloader-args', `aria2c:-x${settings.ariaConnections} -s${settings.ariaConnections} -k1M --file-allocation=none --summary-interval=1 --console-log-level=warn`
    );
  }

  if (job.playlistMode === 'single') {
    args.push('--no-playlist');
  } else if (job.playlistMode === 'playlist') {
    args.push('--yes-playlist');
  }

  if (job.playlistItems) args.push('--playlist-items', job.playlistItems);
  args.push(job.overwrite ? '--force-overwrites' : '--no-overwrites');

  if (job.mediaKind === 'audio') {
    args.push('--extract-audio', '--audio-format', job.audioFormat, '--audio-quality', '0');
  } else {
    args.push('--format', videoFormatSelector(job.quality, job.videoContainer));
    if (job.videoContainer !== 'auto') {
      args.push('--merge-output-format', job.videoContainer);
    }
  }

  if (job.embedMetadata) args.push('--embed-metadata');
  if (job.embedThumbnail) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
  if (job.includeSubtitles) {
    args.push('--write-subs', '--sub-langs', 'all,-live_chat');
    if (job.includeAutoSubtitles) args.push('--write-auto-subs');
    if (job.mediaKind === 'video') args.push('--embed-subs');
  }
  if (job.removeSponsorSegments) args.push('--sponsorblock-remove', 'default');
  if (job.cookiesBrowser && job.cookiesBrowser !== 'none') {
    args.push('--cookies-from-browser', job.cookiesBrowser);
  }

  args.push('--', job.url);
  return args;
}

function buildInspectArgs(url, cookiesBrowser = 'none') {
  const args = [
    '--ignore-config',
    '--dump-single-json',
    '--flat-playlist',
    '--ignore-errors',
    '--skip-download',
    '--no-warnings'
  ];
  if (cookiesBrowser && cookiesBrowser !== 'none') {
    args.push('--cookies-from-browser', cookiesBrowser);
  }
  args.push('--', url);
  return args;
}

function spawnEnvironment(tools, baseEnvironment = process.env) {
  const result = { ...baseEnvironment };
  if (tools.binDirectory) {
    const pathKey = Object.keys(result).find((key) => key.toLowerCase() === 'path') || 'PATH';
    result[pathKey] = `${tools.binDirectory}${path.delimiter}${result[pathKey] || ''}`;
  }
  result.PYTHONUTF8 = '1';
  return result;
}

module.exports = {
  videoFormatSelector,
  outputTemplate,
  buildDownloadArgs,
  buildInspectArgs,
  spawnEnvironment
};
