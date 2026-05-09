# NyaMark Custom NSIS Installer Template
# Adapted for Tauri 2.0

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"

# These placeholders will be replaced by Tauri's bundler
!define PRODUCT_NAME "{{product_name}}"
!define PRODUCT_VERSION "{{version}}"
!define BUNDLE_IDENTIFIER "{{bundle_identifier}}"
!define MANUFACTURER "{{manufacturer}}"
!define MAIN_BINARY_NAME "{{main_binary_name}}"
!define MAIN_BINARY_PATH "{{main_binary_path}}"

Name "${PRODUCT_NAME}"
OutFile "${MAIN_BINARY_NAME}_${PRODUCT_VERSION}_x64_en-US.exe" # Tauri will override this
InstallDir "$PROGRAMFILES64\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\${PRODUCT_NAME}" ""

ShowInstDetails show
ShowUninstDetails show

# --- UI Settings ---
!define MUI_ABORTWARNING
!define MUI_ICON "{{installer_icon}}"
!define MUI_UNICON "{{uninstaller_icon}}"

# --- Pages ---
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "{{license}}"
!insertmacro MUI_PAGE_COMPONENTS # This is where our options will show up
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

# --- Languages ---
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

# --- Sections ---

Section "Main Application (Required)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  
  # Copy files (Tauri will handle the actual copying, this is a placeholder)
  # File /r "{{resources}}\*"
  # File "{{main_binary_path}}"
  
  # Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
  
  # Registry keys for uninstaller
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayIcon" "$INSTDIR\${MAIN_BINARY_NAME}.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "Publisher" "${MANUFACTURER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion" "${PRODUCT_VERSION}"
SectionEnd

Section "Associate with Markdown files (.md)" SecAssociate
  # Register .md extension
  WriteRegStr HKCR ".md" "" "NyaMark.Markdown"
  WriteRegStr HKCR ".markdown" "" "NyaMark.Markdown"
  WriteRegStr HKCR ".mdown" "" "NyaMark.Markdown"
  WriteRegStr HKCR ".mkdn" "" "NyaMark.Markdown"
  
  # Define the NyaMark.Markdown file type
  WriteRegStr HKCR "NyaMark.Markdown" "" "Markdown File"
  WriteRegStr HKCR "NyaMark.Markdown\DefaultIcon" "" "$INSTDIR\${MAIN_BINARY_NAME}.exe,0"
  WriteRegStr HKCR "NyaMark.Markdown\shell\open\command" "" '"$INSTDIR\${MAIN_BINARY_NAME}.exe" "%1"'
SectionEnd

Section "Add to Context Menu (Right-click)" SecContextMenu
  # Add "Open with NyaMark" for all files
  WriteRegStr HKCR "*\shell\NyaMark" "" "Open with NyaMark"
  WriteRegStr HKCR "*\shell\NyaMark" "Icon" "$INSTDIR\${MAIN_BINARY_NAME}.exe,0"
  WriteRegStr HKCR "*\shell\NyaMark\command" "" '"$INSTDIR\${MAIN_BINARY_NAME}.exe" "%1"'
  
  # Add for directories too
  WriteRegStr HKCR "Directory\shell\NyaMark" "" "Open Folder in NyaMark"
  WriteRegStr HKCR "Directory\shell\NyaMark" "Icon" "$INSTDIR\${MAIN_BINARY_NAME}.exe,0"
  WriteRegStr HKCR "Directory\shell\NyaMark\command" "" '"$INSTDIR\${MAIN_BINARY_NAME}.exe" "%1"'
SectionEnd

Section "Create Desktop Shortcut" SecShortcut
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${MAIN_BINARY_NAME}.exe" "" "$INSTDIR\${MAIN_BINARY_NAME}.exe" 0
SectionEnd

# --- Descriptions ---
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "Core application files."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAssociate} "Make NyaMark the default editor for .md and other Markdown files."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecContextMenu} "Add 'Open with NyaMark' to the right-click menu in Windows Explorer."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecShortcut} "Create a shortcut on your desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

# --- Uninstaller Section ---
Section "Uninstall"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  
  # Remove Context Menu
  DeleteRegKey HKCR "*\shell\NyaMark"
  DeleteRegKey HKCR "Directory\shell\NyaMark"
  
  # Remove File Association (Optional: might want to check if it's still NyaMark)
  DeleteRegKey HKCR ".md"
  DeleteRegKey HKCR "NyaMark.Markdown"
  
  # Remove application files and registry
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
SectionEnd
