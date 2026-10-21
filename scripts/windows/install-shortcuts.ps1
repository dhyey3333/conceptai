# Create the ConceptAI shortcuts so the app runs without a terminal:
#   Desktop:     ConceptAI          (starts it if needed and opens it in the browser)
#   Start menu:  ConceptAI, Stop ConceptAI
#
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-shortcuts.ps1
#     -StartWithWindows     also start it in the background when you sign in
#     -NoStartWithWindows   stop doing that
#     -Remove               remove every ConceptAI shortcut
param([switch]$StartWithWindows, [switch]$NoStartWithWindows, [switch]$Remove)
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here "..\..")).Path
$vbs = Join-Path $here "ConceptAI.vbs"
$icon = Join-Path $here "conceptai.ico"
$wsh = New-Object -ComObject WScript.Shell
$menu = Join-Path ([Environment]::GetFolderPath("Programs")) "ConceptAI"
$autostart = Join-Path ([Environment]::GetFolderPath("Startup")) "ConceptAI (background).lnk"
$links = @(
  @{ Path = (Join-Path ([Environment]::GetFolderPath("Desktop")) "ConceptAI.lnk"); Args = ""; Desc = "Open ConceptAI, your AI teacher" },
  @{ Path = (Join-Path $menu "ConceptAI.lnk"); Args = ""; Desc = "Open ConceptAI, your AI teacher" },
  @{ Path = (Join-Path $menu "Stop ConceptAI.lnk"); Args = "--stop"; Desc = "Stop ConceptAI running in the background" }
)

function Make-Shortcut($path, $arguments, $description) {
  $s = $wsh.CreateShortcut($path)
  # wscript runs the launcher with no console window.
  $s.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
  $s.Arguments = ("`"$vbs`" $arguments").Trim()
  $s.WorkingDirectory = $root
  $s.IconLocation = "$icon,0"
  $s.Description = $description
  $s.Save()
  "created  $path"
}

if ($Remove) {
  foreach ($p in @($links | ForEach-Object { $_.Path }) + $autostart) {
    if (Test-Path $p) { Remove-Item $p; "removed  $p" }
  }
  if ((Test-Path $menu) -and -not (Get-ChildItem $menu)) { Remove-Item $menu }
  exit 0
}

New-Item -ItemType Directory -Force $menu | Out-Null
foreach ($l in $links) { Make-Shortcut $l.Path $l.Args $l.Desc }
if ($StartWithWindows) { Make-Shortcut $autostart "--background" "Start ConceptAI in the background when you sign in" }
if ($NoStartWithWindows -and (Test-Path $autostart)) { Remove-Item $autostart; "removed  $autostart" }
