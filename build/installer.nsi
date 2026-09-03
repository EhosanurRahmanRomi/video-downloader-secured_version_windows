Unicode True
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ShowInstDetails nevershow
ShowUninstDetails nevershow

!include "MUI2.nsh"

!define PRODUCT_NAME "VideoAI Downloader"
!define PRODUCT_PUBLISHER "VideoAI Downloader"
!define PRODUCT_WEB_SITE "https://github.com/yt-dlp/yt-dlp"
!define PRODUCT_REG_KEY "Software\VideoAI Downloader"
!define PRODUCT_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\VideoAI Downloader"

Name "${PRODUCT_NAME}"
Caption "${PRODUCT_NAME} ${APP_VERSION} Setup"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\VideoAI Downloader"
InstallDirRegKey HKCU "${PRODUCT_REG_KEY}" "InstallLocation"
BrandingText "VideoAI Downloader ${APP_VERSION}"
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "FileDescription" "${PRODUCT_NAME} Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "MIT License"

!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_WELCOMEPAGE_TITLE "Install ${PRODUCT_NAME}"
!define MUI_WELCOMEPAGE_TEXT "Setup will install ${PRODUCT_NAME} ${APP_VERSION} on your computer.$\r$\n$\r$\nThe app includes its verified download engine and does not require Python, FFmpeg, yt-dlp, or aria2 to be installed separately."
!define MUI_FINISHPAGE_TITLE "${PRODUCT_NAME} is ready"
!define MUI_FINISHPAGE_TEXT "Setup has finished installing ${PRODUCT_NAME}."
!define MUI_FINISHPAGE_RUN "$INSTDIR\VideoAI Downloader.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch VideoAI Downloader"

!define MUI_STARTMENUPAGE_REGISTRY_ROOT "HKCU"
!define MUI_STARTMENUPAGE_REGISTRY_KEY "${PRODUCT_REG_KEY}"
!define MUI_STARTMENUPAGE_REGISTRY_VALUENAME "Start Menu Folder"
!define MUI_STARTMENUPAGE_DEFAULTFOLDER "VideoAI Downloader"

Var StartMenuFolder

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE_FILE}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_STARTMENU Application $StartMenuFolder
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  FindWindow $0 "" "VideoAI Downloader"
  StrCmp $0 0 done
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "VideoAI Downloader is running. Close it, then click OK to continue Setup." IDOK done
  Abort
done:
FunctionEnd

Section "Install" MainSection
  SetShellVarContext current
  SetOverwrite on
  SetOutPath "$INSTDIR"
  File /r "${APP_SOURCE}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${PRODUCT_REG_KEY}" "InstallLocation" "$INSTDIR"

  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$StartMenuFolder\VideoAI Downloader.lnk" "$INSTDIR\VideoAI Downloader.exe" "" "$INSTDIR\VideoAI Downloader.exe" 0
    CreateShortcut "$SMPROGRAMS\$StartMenuFolder\Uninstall VideoAI Downloader.lnk" "$INSTDIR\Uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END
  CreateShortcut "$DESKTOP\VideoAI Downloader.lnk" "$INSTDIR\VideoAI Downloader.exe" "" "$INSTDIR\VideoAI Downloader.exe" 0

  WriteRegStr HKCU "${PRODUCT_UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PRODUCT_UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${PRODUCT_UNINSTALL_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${PRODUCT_UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\VideoAI Downloader.exe"
  WriteRegStr HKCU "${PRODUCT_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${PRODUCT_UNINSTALL_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegStr HKCU "${PRODUCT_UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${PRODUCT_UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "${PRODUCT_UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${PRODUCT_UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${PRODUCT_UNINSTALL_KEY}" "EstimatedSize" ${ESTIMATED_SIZE}
SectionEnd

Function un.onInit
  FindWindow $0 "" "VideoAI Downloader"
  StrCmp $0 0 done
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Close VideoAI Downloader, then click OK to continue uninstalling." IDOK done
  Abort
done:
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro MUI_STARTMENU_GETFOLDER Application $StartMenuFolder
  Delete "$DESKTOP\VideoAI Downloader.lnk"
  Delete "$SMPROGRAMS\$StartMenuFolder\VideoAI Downloader.lnk"
  Delete "$SMPROGRAMS\$StartMenuFolder\Uninstall VideoAI Downloader.lnk"
  RMDir "$SMPROGRAMS\$StartMenuFolder"
  DeleteRegKey HKCU "${PRODUCT_UNINSTALL_KEY}"
  DeleteRegKey HKCU "${PRODUCT_REG_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
