# Builds a small update package for a machine that already runs EAP Monitor.
#
# The full deploy zip is ~50 MB, but almost all of that is node_modules and the
# portable Node runtime, which never change between releases. This packs only
# the application code - typically well under 10 MB.
#
# Deliberately NOT included:
#   .env          the target machine has its own credentials; overwriting it
#                 would point the server at the wrong database
#   qr-logs/      production data written by the running server
#   node_modules/ and node-portable/   unchanged unless dependencies move
#
# Run it from the project, or double-click backend\make-update-package.bat:
#   powershell -ExecutionPolicy Bypass -File backend\tools\make-update-package.ps1

$ErrorActionPreference = 'Stop'

$backend = Split-Path -Parent $PSScriptRoot      # ...\backend\tools -> ...\backend
$project = Split-Path -Parent $backend           # ...\plc-full-project

# Paths are relative to the project root, so the zip extracts straight over it.
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
$zip   = Join-Path ([Environment]::GetFolderPath('Desktop')) "eap-monitor-update-$stamp.zip"
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

$mb = '{0:N1}' -f ((Get-Item $zip).Length / 1MB)
Write-Host ""
Write-Host "Update package : $zip"
Write-Host "Files          : $($files.Count)"
Write-Host "Size           : $mb MB"
Write-Host ""
Write-Host "On the target machine:"
Write-Host "  1. Extract it over the project folder, replacing files when asked."
Write-Host "  2. Frontend changes apply on the next page load - no restart."
Write-Host "     If eap-server.js or anything in backend\lib changed, restart the server."
Write-Host ""
Write-Host "It does NOT touch .env or qr-logs, so the target keeps its own settings and data."
