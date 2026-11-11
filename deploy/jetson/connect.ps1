param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]*$')]
    [string]$JetsonAddress = 'chambit-jetson',
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')]
    [string]$UserName = 'taewoo',
    [ValidateRange(1024, 65535)]
    [int]$LocalPort = 5502
)
$ErrorActionPreference = 'Stop'
Write-Host "Connect at http://localhost:$LocalPort after SSH authentication. Keep this terminal open."
# Bind the forwarded port only to this PC; leave host-key verification enabled.
& ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 `
    -L "127.0.0.1:${LocalPort}:127.0.0.1:5500" "${UserName}@${JetsonAddress}"
exit $LASTEXITCODE
