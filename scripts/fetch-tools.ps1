$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BinDirectory = Join-Path $ProjectRoot "resources\toolchain"
$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("videoai-tools-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $BinDirectory, $TemporaryDirectory | Out-Null

try {
    $YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe"
    $FfmpegUrl = "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl-shared.zip"
    $AriaUrl = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip"

    Invoke-WebRequest -Uri $YtDlpUrl -OutFile (Join-Path $BinDirectory "yt-dlp.exe")
    Invoke-WebRequest -Uri $FfmpegUrl -OutFile (Join-Path $TemporaryDirectory "ffmpeg.zip")
    Invoke-WebRequest -Uri $AriaUrl -OutFile (Join-Path $TemporaryDirectory "aria2.zip")

    Expand-Archive -Path (Join-Path $TemporaryDirectory "ffmpeg.zip") -DestinationPath (Join-Path $TemporaryDirectory "ffmpeg") -Force
    Expand-Archive -Path (Join-Path $TemporaryDirectory "aria2.zip") -DestinationPath (Join-Path $TemporaryDirectory "aria2") -Force

    Get-ChildItem (Join-Path $TemporaryDirectory "ffmpeg") -Recurse -File |
        Where-Object { $_.Directory.Name -eq "bin" -and $_.Extension -in ".exe", ".dll" -and $_.Name -ne "ffplay.exe" } |
        Copy-Item -Destination $BinDirectory -Force
    Get-ChildItem (Join-Path $TemporaryDirectory "aria2") -Recurse -Filter "aria2c.exe" |
        Select-Object -First 1 |
        Copy-Item -Destination $BinDirectory -Force

    $env:VIDEOAI_YTDLP_VERSION = (& (Join-Path $BinDirectory "yt-dlp.exe") --version | Select-Object -First 1).Trim()
    $env:VIDEOAI_FFMPEG_VERSION = ((& (Join-Path $BinDirectory "ffmpeg.exe") -version | Select-Object -First 1) -replace '^ffmpeg version\s+', '').Trim()
    $env:VIDEOAI_ARIA2_VERSION = (((& (Join-Path $BinDirectory "aria2c.exe") --version | Select-Object -First 1) -replace '^aria2 version\s+', '') -split '\s+')[0]).Trim()
    & node (Join-Path $PSScriptRoot "generate-tool-manifest.js")
}
finally {
    Remove-Item -Recurse -Force $TemporaryDirectory -ErrorAction SilentlyContinue
}
