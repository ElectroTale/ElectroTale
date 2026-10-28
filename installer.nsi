Unicode true
!include "MUI2.nsh"
!define APPNAME "ElectroTale"
!define APPEXE "ElectroTale.exe"
!ifndef VERSION
  !define VERSION "1.10.0"
!endif
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ElectroTale"

Name "${APPNAME}"
OutFile "ElectroTale-Installation.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APPNAME} ${VERSION}"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Installation de ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "ElectroTale : des aventures textuelles avec l'IA, en local sur ton PC (anciennement Kobold Aventure).$\r$\n$\r$\nVersion bêta : imaginée et dirigée par Béryl, codée par Claude (Anthropic). Réservée aux 18 ans et plus.$\r$\n$\r$\nL'ancienne version sera remplacée, et tes aventures, modèles et réglages seront repris automatiquement.$\r$\n$\r$\nFerme l'application si elle est ouverte avant de continuer."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_FRENCH} "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_FRENCH} "FileDescription" "Installation de ${APPNAME}"
VIAddVersionKey /LANG=${LANG_FRENCH} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_FRENCH} "LegalCopyright" "Béryl"

Section "Installer"
  ; retire l'ancienne version « Kobold Aventure » (les sauvegardes dans AppData ne sont pas touchées)
  IfFileExists "$LOCALAPPDATA\Programs\Kobold Aventure\*.*" 0 noold
    RMDir /r "$LOCALAPPDATA\Programs\Kobold Aventure"
    Delete "$DESKTOP\Kobold Aventure.lnk"
    RMDir /r "$SMPROGRAMS\Kobold Aventure"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KoboldAventure"
    DeleteRegKey HKCU "Software\Kobold Aventure"
  noold:
  SetOutPath "$INSTDIR"
  ; supprime l'ancienne version de l'app (pas les sauvegardes, qui sont dans AppData)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "dist\ElectroTale-win32-x64\*.*"
  WriteUninstaller "$INSTDIR\Desinstaller.exe"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${APPEXE}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Désinstaller ${APPNAME}.lnk" "$INSTDIR\Desinstaller.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Béryl"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Desinstaller.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPNAME}"
  IfSilent +2
  MessageBox MB_OK "${APPNAME} est désinstallé.$\r$\nTes aventures, modèles et réglages sont toujours dans %APPDATA%\${APPNAME} (supprime ce dossier à la main si tu veux tout effacer)."
SectionEnd
