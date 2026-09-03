# VideoAI Downloader 2.1

A clean-room Windows desktop application for downloading individual videos, audio, and playlists through yt-dlp. The interface is an Electron shell; all download execution is isolated in the main process and uses argument arrays rather than shell command strings.

## Highlights

- Two independent speed controls: simultaneous videos and concurrent DASH/HLS fragments
- Optional aria2 multi-connection acceleration for direct HTTP/FTP media files
- Complete playlist analysis with thumbnails, titles, creators, durations, search, and individual checkboxes
- Select-all, clear, invert, and incremental rendering for very large playlists
- One yt-dlp process per playlist job, preventing duplicate playlist-index workers
- Per-download archive files, duplicate-job protection, and safe no-overwrite defaults
- Pause by stopping the process while preserving `.part` files; resume restarts with yt-dlp continuation enabled
- Video quality caps from 360p through 4K, automatic format fallbacks, and audio extraction
- Metadata, thumbnails, subtitles, automatic captions, SponsorBlock, and browser-cookie options
- Persistent queue/history with interrupted jobs restored as paused
- Structured progress, redacted diagnostic logs, component integrity checks, and in-app yt-dlp updates
- Context-isolated, sandboxed renderer with a restrictive Content Security Policy

## Requirements

- Windows 10 or Windows 11, x64
- An internet connection
- Permission from the copyright owner or applicable law to save the requested content

The normal Setup build creates Start menu and desktop shortcuts and registers a Windows uninstaller. A direct-launch portable build is also provided. Neither build requires a separate Python, FFmpeg, yt-dlp, or aria2 installation.

## Build from source

Install Node.js 22 or later, then run:

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts\fetch-tools.ps1
npm test
npm run dist:win
```

The normal Windows Setup executable, direct-launch portable executable, and SHA-256 checksums are written to `release\`. NSIS is used for the Setup wizard; set `MAKENSIS_PATH` if it is not installed or available through the electron-builder cache.

## Test

```powershell
npm test
```

The tests cover URL and option validation, complete playlist enumeration, visual item selection, large-list rendering, compact selection ranges, argument generation, high-speed controls, progress parsing, log redaction, queue concurrency, duplicate prevention, pause/resume behavior, archive isolation, interrupted-job recovery, process outcomes, and bundled-tool integrity.

## Architecture

- `src/main.js`: secure Electron lifecycle and IPC boundary
- `src/preload.js`: narrow renderer API
- `src/core/`: validation, command generation, queue manager, process runner, inspection, persistence, and tool integrity
- `src/renderer/`: accessible desktop UI
- `test/`: Node test suite with deterministic process doubles
- `resources/toolchain/`: generated/downloaded Windows toolchain; checksummed by `tools-manifest.json`

## Reliability notes

Website changes can temporarily break individual extractors. Use **Settings → Update yt-dlp** before reporting a site-specific failure. Download speed is still limited by the source website, route quality, disk speed, and ISP; increasing connections beyond a site's tolerance can reduce reliability.

Partial files and download history are stored in the normal per-user application-data directory, so interrupted transfers can be resumed after restarting the app. Existing completed files are protected unless **Overwrite existing files** is explicitly enabled.
