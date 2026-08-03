@echo off
title Apply Germany DoH
color 0A

echo Applying Germany DoH...

:: Get adapter with default gateway (active internet)
for /f "tokens=4" %%a in ('route print 0.0.0.0 ^| findstr /C:"0.0.0.0"') do set IFACE=%%a

if "%IFACE%"=="" (
    echo ERROR: No active internet adapter found.
    exit /b 1
)

:: Register DoH servers
netsh dns add encryption server=187.127.83.147 dohtemplate=https://srv1469651.hstgr.cloud/dns-query autoupgrade=yes udpfallback=no >nul 2>&1
netsh dns add encryption server=1.1.1.1 dohtemplate=https://cloudflare-dns.com/dns-query autoupgrade=yes udpfallback=no >nul 2>&1

:: Configure DNS
netsh interface ipv4 set dnsservers name="%IFACE%" static 187.127.83.147 primary >nul
netsh interface ipv4 add dnsservers name="%IFACE%" 1.1.1.1 index=2 >nul

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
