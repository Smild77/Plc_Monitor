# Builds a full deploy package for a PC that has never run SENTRA before.
#
# Produces on the Desktop:
#   sentra-deploy-<stamp>.zip   the whole project, ready to extract and run
#
# This is NOT the same thing as make-update-package.ps1. That one ships only
# the app files, because the target already has node_modules and a .env of its
# own. This one has to carry everything, so the target needs nothing but
# Windows - not even Node.js.
#
# INCLUDES node-portable\ - the Node.js runtime itself. start-server.bat picks
# it up automatically, so nobody has to install Node on the target PC (which
# usually needs admin rights the line operator does not have). It is the single
# biggest thing in the zip; everything else together is a fraction of it.
#
# INCLUDES backend\.env - the real Oracle credentials travel inside the zip so
# the new PC starts without anyone typing a password. Treat the zip as
# confidential: do not leave it on a shared drive or a USB stick that gets
# passed around.
#
# Deliberately left out:
#   backend/qr-logs/   THIS machine's recorded production data. A new PC starts
#                      with an empty log; the server recreates the folder.
#   .git .vscode .claude   developer-side only, and .git alone is larger than
#                      everything else put together.
#   *.bak *.tmp        layout-editor scratch files
#
# Run via  powershell -ExecutionPolicy Bypass -File backend\tools\make-deploy-package.ps1

$ErrorActionPreference = 'Stop'

$backend = Split-Path -Parent $PSScriptRoot      # ...\backend\tools -> ...\backend
$project = Split-Path -Parent $backend           # ...\plc-full-project
$desktop = [Environment]::GetFolderPath('Desktop')

if (-not (Test-Path (Join-Path $backend 'eap-server.js'))) {
    throw "eap-server.js not found - run this from inside the project."
}

# An exclude list rather than an include list: a folder added to the project
# later ships automatically instead of being silently dropped from the zip.
$excludeDirs = @('.git', '.vscode', '.claude')
$excludeRel  = @('backend\qr-logs')

$prefix = $project.TrimEnd([char]92).Length + 1

$files = Get-ChildItem -LiteralPath $project -Recurse -File -Force | Where-Object {
    $rel = $_.FullName.Substring($prefix)
    $parts = $rel -split '\\'
    if ($excludeDirs | Where-Object { $parts -contains $_ }) { return $false }
    if ($excludeRel  | Where-Object { $rel -like "$_\*" })   { return $false }
    if ($_.Extension -in '.bak', '.tmp')                     { return $false }
    return $true
}

if ($files.Count -eq 0) { throw "Nothing to package." }

# Fail loudly rather than shipping a zip that cannot start. Each of these is
# something a fresh PC has no way to recreate on its own.
foreach ($must in 'backend\.env', 'backend\eap-server.js', 'backend\start-server.bat',
                  'backend\node_modules\oracledb\package.json', 'frontend\index.html') {
    if (-not (Test-Path (Join-Path $project $must))) { throw "Missing from the package: $must" }
}

# node-portable is not fatal - a target that already has Node.js runs fine
# without it - but shipping without it silently turns a double-click install
# into an IT ticket, so say so rather than let it pass quietly.
$nodeExe = Join-Path $project 'node-portable\node.exe'
if (Test-Path $nodeExe) {
    $nodeVer = (& $nodeExe -v).Trim()
    Write-Host "Portable Node  : $nodeVer  (target PC needs no install)"
} else {
    Write-Host "[WARN] node-portable\node.exe is missing - the target PC will have to"
    Write-Host "       install Node.js itself. To bundle it, extract node-vNN-win-x64.zip"
    Write-Host "       so that node.exe sits directly in  <project>\node-portable\"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$zip   = Join-Path $desktop "sentra-deploy-$stamp.zip"
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$bs = [char]92   # \
$fw = [char]47   # /   ZIP entry names must use forward slashes

$fs = [System.IO.File]::Open($zip, 'CreateNew')
$ar = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Create)
foreach ($f in $files) {
    $rel = $f.FullName.Substring($prefix).Replace($bs, $fw)
    $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $ar, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
}
$ar.Dispose()
$fs.Dispose()

# Read the finished zip back and report what is actually inside it, rather than
# the in-memory list we believed we wrote. A deploy zip that quietly disagrees
# with its own summary is worse than no summary at all - this is how a stray
# node-portable folder went unnoticed once.
$check = [System.IO.Compression.ZipFile]::OpenRead($zip)
$actual = $check.Entries.Count
$tops = $check.Entries | ForEach-Object { ($_.FullName -split $fw)[0] } | Group-Object |
        Sort-Object Count -Descending
$check.Dispose()

$zipMb = '{0:N1}' -f ((Get-Item $zip).Length / 1MB)

if ($actual -ne $files.Count) {
    Write-Host "[WARN] expected $($files.Count) entries but the zip holds $actual - inspect it before shipping."
}

Write-Host ""
Write-Host "Deploy zip     : $zip   ($zipMb MB)"
Write-Host "Entries        : $actual"
Write-Host "Top level      :"
foreach ($t in $tops) { Write-Host ("                 {0,6}  {1}" -f $t.Count, $t.Name) }
Write-Host ""
Write-Host "On the new PC (nothing to install):"
Write-Host "  1. Extract the zip anywhere, e.g.  D:\server\plc-full-project"
Write-Host "  2. Run  backend\create-shortcut.bat   to put the icon on the desktop"
Write-Host "  3. Double-click the shortcut"
Write-Host ""
Write-Host "The zip contains backend\.env with the live Oracle password - keep it confidential."
