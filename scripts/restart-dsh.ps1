# restart-dsh.ps1 - restart DeepSeek Harness (dsh) desktop app
#
# dsh is an Electron app whose browser process runs with a bare exe command
# line (no --type=, no --expose-internals). Ending it tears down all children.
# Relaunch MUST go through the desktop shortcut (explorer.exe <lnk>) because
# the exe depends on the shortcut's working directory; a bare Start-Process
# on the exe silently exits at startup.

$ErrorActionPreference = 'Stop'

$exePath = 'D:/software/dsh/DeepSeek Harness.exe'
$lnkPath = Join-Path $env:USERPROFILE 'Desktop\DeepSeek Harness.lnk'

if (-not (Test-Path -LiteralPath $exePath)) {
    Write-Error "[restart-dsh] dsh exe not found: $exePath"
    exit 1
}

Write-Host "[restart-dsh] locating Electron browser (main) process ..."

$mains = Get-CimInstance Win32_Process -Filter "name='DeepSeek Harness.exe'" |
    Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'expose-internals' }

if (-not $mains) {
    Write-Host "[restart-dsh] no browser process found."
} else {
    foreach ($p in $mains) {
        Write-Host "[restart-dsh] stopping browser PID=$($p.ProcessId) ..."
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    $waited = 0
    while ($waited -lt 20) {
        $remaining = Get-CimInstance Win32_Process -Filter "name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue
        if (-not $remaining) { break }
        Start-Sleep -Milliseconds 500
        $waited++
    }
}

Write-Host "[restart-dsh] relaunching dsh via desktop shortcut ..."
if (Test-Path -LiteralPath $lnkPath) {
    Start-Process -FilePath "explorer.exe" -ArgumentList "`"$lnkPath`""
} else {
    Write-Host "[restart-dsh] shortcut not found, falling back to direct exe launch."
    Start-Process -FilePath $exePath -WorkingDirectory (Split-Path $exePath)
}

Write-Host "[restart-dsh] done."
