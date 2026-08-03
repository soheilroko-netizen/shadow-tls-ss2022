@echo off
title Reset DNS to DHCP
color 0C

echo Resetting DNS to automatic (DHCP)...

:: Get adapter with default gateway (active internet)
for /f "tokens=4" %%a in ('route print 0.0.0.0 ^| findstr /C:"0.0.0.0"') do set IFACE=%%a

if "%IFACE%"=="" (
    echo ERROR: No active internet adapter found.
    exit /b 1
)

:: Remove DoH registrations
netsh dns delete encryption server=62.238.60.136 >nul 2>&1
netsh dns delete encryption server=187.127.83.147 >nul 2>&1

:: Restore automatic DNS (DHCP)
netsh interface ipv4 set dnsservers name="%IFACE%" source=dhcp >nul

:: Flush DNS cache
ipconfig /flushdns >nul

:: Verify
echo.
echo ======================================================
echo Active adapter: %IFACE%
echo ======================================================
netsh interface ipv4 show dnsservers name="%IFACE%"
echo.

exit /b 0
