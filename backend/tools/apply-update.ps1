# Applies an update package on the machine that runs SENTRA.
#
# Copying the files by hand fails while the server is running: node.exe holds
# the files it serves, so Explorer refuses to replace them - and when it fails
# quietly, the page keeps showing the old version and it looks like the update
# simply did nothing.
#
# So: stop the server, replace the files, and let the caller start it again.
#
# Run it via backend\apply-update.bat rather than directly.

$ErrorActionPreference = 'Stop'

$backend = Split-Path -Parent $PSScriptRoot      # ...\backend\tools -> ...\backend
$project = Split-Path -Parent $backend           # ...\plc-full-project
$port    = 3001

# --- find the newest update package -----------------------------------------
$searchDirs = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:USERPROFILE 'Downloads'),
    (Split-Path -Parent $project),
    $project
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$zip = $searchDirs |
    ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter 'eap-monitor-update-*.zip' -File -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $zip) {
    Write-Host "[ERROR] No eap-monitor-update-*.zip found."
    Write-Host "        Looked in:"
    $searchDirs | ForEach-Object { Write-Host "          $_" }
    Write-Host ""
    Write-Host "        Copy the update package to the Desktop and run this again."
    exit 1
}

$mb = '{0:N1}' -f ($zip.Length / 1MB)
Write-Host "Update package : $($zip.FullName)"
Write-Host "Built          : $($zip.LastWriteTime)"
Write-Host "Size           : $mb MB"
Write-Host "Installing to  : $project"
Write-Host ""

# --- stop the server so the files stop being locked --------------------------
$stopped = $false
$listeners = netstat -ano | Select-String 'LISTENING' | Select-String ":$port\s"
foreach ($line in $listeners) {
    $procId = ($line -split '\s+' | Where-Object { $_ })[-1]
    if ($procId -match '^\d+$') {
        Write-Host "Stopping server (PID $procId) ..."
        try { Stop-Process -Id ([int]$procId) -Force -ErrorAction Stop; $stopped = $true }
        catch { Write-Host "  could not stop PID ${procId}: $($_.Exception.Message)" }
    }
}
if (-not $stopped) { Write-Host "No running server found on port $port - nothing to stop." }
Start-Sleep -Seconds 2
Write-Host ""

# --- replace the files -------------------------------------------------------
Write-Host "Replacing files ..."
try {
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath $project -Force
} catch {
    Write-Host ""
    Write-Host "[ERROR] Could not replace the files:"
    Write-Host "        $($_.Exception.Message)"
    Write-Host ""
    Write-Host "        If it says access denied, the project sits somewhere that needs"
    Write-Host "        admin rights - right-click apply-update.bat and Run as administrator."
    exit 1
}

Write-Host "Done - files replaced."
Write-Host ""
Write-Host "Updated:"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip.FullName)
$archive.Entries | Select-Object -First 6 | ForEach-Object { Write-Host "  $($_.FullName)" }
if ($archive.Entries.Count -gt 6) { Write-Host "  ... and $($archive.Entries.Count - 6) more" }
$archive.Dispose()
