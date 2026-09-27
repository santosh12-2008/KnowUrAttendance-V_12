# wait_and_open.ps1
#
# Why this file exists
# ---------------------
# start_portal.bat used to do `start http://localhost:8000` immediately followed by
# launching uvicorn. Both lines fire back-to-back, but uvicorn takes a moment to actually
# bind the port and accept connections - so Chrome opened against a server that wasn't
# listening yet and showed "This site can't be reached". Hitting refresh a second later
# worked purely by accident, because by then uvicorn had caught up.
#
# This script polls the server instead of guessing a fixed delay, and only opens the
# browser once something really answers on port 8000. It runs in its own short-lived,
# minimized window (started by start_portal.bat) so the main window is left free to show
# uvicorn's own logs, and Ctrl+C in that main window still stops the server exactly as
# before.

$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-WebRequest -Uri "http://localhost:8000" -UseBasicParsing -TimeoutSec 1 | Out-Null
        $ok = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}

if ($ok) {
    Start-Process "http://localhost:8000"
}
