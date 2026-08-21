# Creates the "SENTRA Server" desktop shortcut on this machine.
#
# The shortcut stores absolute paths, so it cannot be copied between machines -
# run this once after unpacking the project on a new PC:
#
#   powershell -ExecutionPolicy Bypass -File backend\tools\create-desktop-shortcut.ps1
#
# Paths are resolved relative to this script, so it works wherever the project
# folder ends up.

$ErrorActionPreference = 'Stop'

$backend = Split-Path -Parent $PSScriptRoot          # ...\backend\tools -> ...\backend
$bat     = Join-Path $backend 'start-server.bat'
$icon    = Join-Path $backend 'assets\eap-monitor.ico'

if (-not (Test-Path $bat)) {
    throw "start-server.bat not found at $bat - run this from inside the project."
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk     = Join-Path $desktop 'SENTRA Server.lnk'

# The shortcut used to be called "EAP Monitor Server.lnk". Drop the old one so a
# PC that ran the earlier script is not left with two icons on the desktop both
# pointing at the same start-server.bat.
$oldLnk  = Join-Path $desktop 'EAP Monitor Server.lnk'
if (Test-Path $oldLnk) {
    Remove-Item -LiteralPath $oldLnk -Force
    Write-Host "Removed old shortcut : $oldLnk"
}

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath       = $bat
$sc.WorkingDirectory = $backend
$sc.Description      = 'Start SENTRA and open the dashboard'
$sc.WindowStyle      = 1
if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
$sc.Save()

Write-Host "Shortcut created : $lnk"
Write-Host "Target           : $bat"
Write-Host ""
Write-Host "Double-click it on the desktop to start the server."
