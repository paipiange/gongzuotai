# restart-dsh.ps1 - restart DeepSeek Harness (dsh) desktop app
#
# dsh is an Electron app whose browser process runs with a bare exe command
# line (no --type=, no --expose-internals). Ending it tears down all children.
# Relaunch MUST go through the desktop shortcut (explorer.exe <lnk>) because
# the exe depends on the shortcut's working directory; a bare Start-Process
# on the exe silently exits at startup.

$ErrorActionPreference = 'Stop'

$lnkPath = Join-Path $env:USERPROFILE 'Desktop\DeepSeek Harness.lnk'

if (-not (Test-Path -LiteralPath $lnkPath)) {
    Write-Error "[restart-dsh] desktop shortcut not found: $lnkPath"
    exit 1
}

$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnkPath)
$exePath = $shortcut.TargetPath
if (-not $exePath -or -not (Test-Path -LiteralPath $exePath)) {
    Write-Error "[restart-dsh] shortcut target is unavailable"
    exit 1
}
$processName = [System.IO.Path]::GetFileName($exePath)

Write-Host "[restart-dsh] locating Electron browser (main) process ..."

$mains = Get-CimInstance Win32_Process -Filter "name='$processName'" |
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
        $remaining = Get-CimInstance Win32_Process -Filter "name='$processName'" -ErrorAction SilentlyContinue
        if (-not $remaining) { break }
        Start-Sleep -Milliseconds 500
        $waited++
    }
}

Write-Host "[restart-dsh] relaunching dsh via desktop shortcut ..."
Start-Process -FilePath "explorer.exe" -ArgumentList "`"$lnkPath`""

Write-Host "[restart-dsh] done."
