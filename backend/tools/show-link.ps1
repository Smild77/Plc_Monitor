# Prints the address other people on the network should open.
#
# The server prints this at startup, but that scrolls away - and once the
# console is closed there is nothing left to read. This works out the same
# answer at any time, from .env and the machine's own network config, rather
# than from a link somebody wrote down once.
#
# Run via backend\show-link.bat

$ErrorActionPreference = 'Stop'

$backend = Split-Path -Parent $PSScriptRoot      # ...\backend\tools -> ...\backend
$envFile = Join-Path $backend '.env'

# The port is whatever .env says; sentra-server.js falls back to 3001 the same way.
$port = 3001
$source = 'default (no .env found)'
if (Test-Path $envFile) {
    $hit = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($hit) {
        $port = [int]$hit.Matches[0].Groups[1].Value
        $source = 'backend\.env'
    } else {
        $source = 'default (PORT not set in .env)'
    }
}

Write-Host ""
Write-Host "Port     : $port   (from $source)"

$listening = @(netstat -ano | Select-String 'LISTENING' | Select-String ":$port\s")
if ($listening.Count -gt 0) {
    Write-Host "Server   : RUNNING"
} else {
    Write-Host "Server   : NOT RUNNING - start it with start-server.bat first,"
    Write-Host "           otherwise these links will not open for anyone."
}

# Skip loopback and 169.254.x: APIPA addresses appear when an adapter failed to
# get a real address, and are useless to anybody else on the network.
$ips = @()
try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
} catch {
    $ips = (ipconfig) | Select-String 'IPv4' | ForEach-Object {
        ($_ -split ':')[-1].Trim()
    } | Where-Object { $_ -ne '127.0.0.1' -and $_ -notlike '169.254.*' }
}

Write-Host ""
Write-Host "=========================================="
Write-Host "  Open these from any PC on the network"
Write-Host "=========================================="
Write-Host ""
Write-Host "  By computer name (survives a DHCP change):"
Write-Host "    http://$env:COMPUTERNAME`:$port/"
Write-Host ""
if ($ips.Count -gt 0) {
    Write-Host "  By IP address:"
    foreach ($ip in $ips) { Write-Host "    http://$ip`:$port/" }
} else {
    Write-Host "  No network address found - this PC is not on a network."
}
Write-Host ""
Write-Host "On this PC itself:  http://localhost:$port/"
Write-Host ""
Write-Host "If a link does not open from another PC, the Windows Firewall is"
Write-Host "blocking port $port - allow it there (needs admin)."
