# Builds update packages for a machine that already runs EAP Monitor.
#
# Produces two things on the Desktop:
#   eap-monitor-update-<stamp>.zip   the payload on its own
#   update-eap.bat                   ONE self-contained file: the same payload
#                                    base64'd inside it, plus the logic to stop
#                                    the server, replace files and start again
#
# The single .bat is the easy path: copy it into the target machine's backend\
# folder and double-click. Nothing else to carry, nothing to extract by hand.
#
# The full deploy zip is ~50 MB, but node_modules and the portable Node runtime
# make up nearly all of it and never change between releases, so neither output
# here includes them.
#
# Deliberately left out:
#   .env          the target has its own credentials; overwriting it would
#                 point the server at the wrong database
#   qr-logs/      production CSV data written by the running server
#
# Run via backend\make-update-package.bat

$ErrorActionPreference = 'Stop'

$backend = Split-Path -Parent $PSScriptRoot      # ...\backend\tools -> ...\backend
$project = Split-Path -Parent $backend           # ...\plc-full-project
$desktop = [Environment]::GetFolderPath('Desktop')

# Paths relative to the project root, so the zip extracts straight over it.
$include = @(
    'frontend',
    'backend/eap-server.js',
    'backend/package.json',
    'backend/package-lock.json',
    'backend/lib',
    'backend/config',
    'backend/sql',
    'backend/tools',
    'backend/start-server.bat',
    'backend/open-ui.bat',
    'backend/create-shortcut.bat',
    'backend/make-update-package.bat'
)
# NOTE: apply-update.bat and update-eap.bat are never packaged. cmd.exe reads a
# .bat incrementally while running it, so replacing the updater mid-run would
# make it execute garbage.

$files = @()
foreach ($rel in $include) {
    $full = Join-Path $project ($rel -replace '/', '\')
    if (-not (Test-Path $full)) { continue }
    if (Test-Path $full -PathType Container) {
        $files += Get-ChildItem -LiteralPath $full -Recurse -File -Force
    } else {
        $files += Get-Item -LiteralPath $full
    }
}
if ($files.Count -eq 0) { throw "Nothing to package - run this from inside the project." }

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$zip   = Join-Path $desktop "eap-monitor-update-$stamp.zip"
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$bs = [char]92   # \
$fw = [char]47   # /   ZIP entry names must use forward slashes

$fs = [System.IO.File]::Open($zip, 'CreateNew')
$ar = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$prefix = $project.TrimEnd($bs).Length + 1
foreach ($f in $files) {
    $rel = $f.FullName.Substring($prefix).Replace($bs, $fw)
    $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $ar, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
}
$ar.Dispose()
$fs.Dispose()

# ---------------------------------------------------------------------------
# Build the single-file updater
# ---------------------------------------------------------------------------

# The worker runs via -EncodedCommand (base64 UTF-16LE), which sidesteps every
# quoting problem that comes with embedding PowerShell in a .bat.
$worker = @'
$ErrorActionPreference = 'Stop'
# Expand-Archive's progress bar turns into pages of CLIXML noise whenever the
# console output is captured rather than shown live.
$ProgressPreference = 'SilentlyContinue'
$bat = $env:EAPBAT
$backend = Split-Path -Parent $bat
$project = Split-Path -Parent $backend
if (-not (Test-Path (Join-Path $backend 'start-server.bat'))) {
  Write-Host '[ERROR] Put this file in the backend folder, next to start-server.bat.'
  Write-Host ("        It is currently in: " + $backend)
  exit 1
}
Write-Host ("Project : " + $project)
$lines = Get-Content -LiteralPath $bat
$i = [array]::IndexOf($lines, ':::PAYLOAD:::')
if ($i -lt 0) { Write-Host '[ERROR] Payload missing - the file is truncated.'; exit 1 }
$b64 = -join $lines[($i + 1)..($lines.Count - 1)]
$tmp = Join-Path $env:TEMP 'eap-update-payload.zip'
[IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String($b64))
$stopped = $false
foreach ($l in (netstat -ano | Select-String 'LISTENING' | Select-String ':3001\s')) {
  $procId = ($l -split '\s+' | Where-Object { $_ })[-1]
  if ($procId -match '^\d+$') {
    Write-Host ("Stopping server (PID " + $procId + ") ...")
    try { Stop-Process -Id ([int]$procId) -Force -ErrorAction Stop; $stopped = $true } catch {}
  }
}
if (-not $stopped) { Write-Host 'No running server found - nothing to stop.' }
Start-Sleep -Seconds 2
Write-Host 'Replacing files ...'
try { Expand-Archive -LiteralPath $tmp -DestinationPath $project -Force }
catch {
  Write-Host '[ERROR] Could not replace the files:'
  Write-Host ("        " + $_.Exception.Message)
  Write-Host '        If it says access denied, right-click this file and Run as administrator.'
  exit 1
}
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
Write-Host 'Done - files replaced.'
exit 0
'@

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))

$payload = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zip))
$chunks = New-Object Collections.Generic.List[string]
for ($p = 0; $p -lt $payload.Length; $p += 1000) {
    $chunks.Add($payload.Substring($p, [Math]::Min(1000, $payload.Length - $p)))
}

$head = @"
@echo off
rem ===========================================================================
rem  EAP Monitor - one-file updater   (built $stamp)
rem
rem  Copy this file into the backend folder on the machine that runs the
rem  server, then double-click it. It stops the server, replaces the app
rem  files with the versions carried inside this file, and starts it again.
rem
rem  It does not touch .env or qr-logs, so the machine keeps its own settings
rem  and its recorded data.
rem
rem  Everything below the :::PAYLOAD::: marker is the update, base64 encoded.
rem  Do not edit this file.
rem ===========================================================================
setlocal
cd /d "%~dp0"
set "EAPBAT=%~f0"

echo ==========================================
echo   EAP Monitor - Update
echo ==========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded
if %errorlevel% neq 0 goto failed

echo.
echo ------------------------------------------
echo Starting the server again...
echo.
start "" "%~dp0start-server.bat"
goto done

:failed
echo.
echo [ERROR] Update was not applied. The server was NOT restarted.
echo         Read the message above, fix it, then run this again.

:done
echo.
pause
goto :eof
:::PAYLOAD:::
"@

$updater = Join-Path $desktop 'update-eap.bat'
if (Test-Path $updater) { Remove-Item -LiteralPath $updater -Force }
$sw = New-Object IO.StreamWriter($updater, $false, [Text.Encoding]::ASCII)
$sw.NewLine = "`r`n"
foreach ($line in ($head -split "`r?`n")) { $sw.WriteLine($line) }
foreach ($c in $chunks) { $sw.WriteLine($c) }
$sw.Close()

$zipMb = '{0:N1}' -f ((Get-Item $zip).Length / 1MB)
$batMb = '{0:N1}' -f ((Get-Item $updater).Length / 1MB)

Write-Host ""
Write-Host "Files packaged : $($files.Count)"
Write-Host ""
Write-Host "ONE-FILE UPDATER (easiest):"
Write-Host "  $updater   ($batMb MB)"
Write-Host "  -> copy it into  <project>\backend\  on the target machine and double-click."
Write-Host ""
Write-Host "Plain zip (if you prefer to extract yourself):"
Write-Host "  $zip   ($zipMb MB)"
Write-Host ""
Write-Host "Neither one touches .env or qr-logs."
