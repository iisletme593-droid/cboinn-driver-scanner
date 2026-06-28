; Cboinn Driver Scanner - Inno Setup installer (replaces the legacy custom C# Setup.exe).
;
; SECURITY MODEL (do not weaken): the app installs into Program Files (admin). The launcher
; (CboinnDriverScanner.exe -> Launcher.cs IsProtectedInstall) REFUSES to run from any non-protected
; folder, and the PowerShell worker (DriverScanner.ps1 -> Test-ProtectedInstallLocation) blocks ALL
; elevated driver operations unless it lives under Program Files. A per-user install would break the
; app entirely, so an elevated Program Files install is required by design.

#define AppName "Cboinn Driver Scanner"
#define AppVersion "4.6.1"
#define AppPublisher "CBOINN"
#define LauncherExe "CboinnDriverScanner.exe"

[Setup]
AppId={{C80B9A1F-4D2E-4A7B-9E3C-7F1A2B3C4D5E}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://cboinn.com/driver-scanner
AppSupportURL=https://cboinn.com/driver-scanner
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=release-inno
OutputBaseFilename=Cboinn-Driver-Scanner-Setup-{#AppVersion}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#LauncherExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany={#AppPublisher}
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}.0

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[Files]
Source: "CboinnDriverScanner.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "DriverScanner.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "ui.xaml"; DestDir: "{app}"; Flags: ignoreversion
Source: "engine\Worker.ps1"; DestDir: "{app}\engine"; Flags: ignoreversion
Source: "icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "logo.png"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "version.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#LauncherExe}"; IconFilename: "{app}\icon.ico"; WorkingDir: "{app}"
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\{#LauncherExe}"; IconFilename: "{app}\icon.ico"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#LauncherExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent runasoriginaluser
