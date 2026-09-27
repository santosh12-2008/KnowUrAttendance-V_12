@echo off
REM Creates a "KnowUrAttendance" shortcut on your Desktop. Run this ONCE.
set "TARGET=%~dp0start_portal.bat"
set "ICON=%~dp0portal.ico"
set "WORKDIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+'\KnowUrAttendance.lnk'); $s.TargetPath=$env:TARGET; $s.WorkingDirectory=$env:WORKDIR; $s.IconLocation=$env:ICON; $s.WindowStyle=7; $s.Description='Open the KnowUrAttendance portal'; $s.Save(); Write-Host ('Shortcut created: ' + $d + '\KnowUrAttendance.lnk')"

if errorlevel 1 (
    echo Could not create the shortcut automatically. Use the manual steps instead.
) else (
    echo Done. Double-click "KnowUrAttendance" on your Desktop from now on.
)
pause
