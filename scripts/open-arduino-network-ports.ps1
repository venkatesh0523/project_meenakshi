$ErrorActionPreference = "Stop"

$wifiIp = "192.168.1.112"

Write-Host "Opening Meenakshi dashboard and MQTT ports for Arduino..."
Write-Host "Wi-Fi IP: $wifiIp"

netsh interface portproxy delete v4tov4 listenaddress=$wifiIp listenport=3000 2>$null
netsh interface portproxy delete v4tov4 listenaddress=$wifiIp listenport=1883 2>$null

netsh interface portproxy add v4tov4 listenaddress=$wifiIp listenport=3000 connectaddress=127.0.0.1 connectport=3000
netsh interface portproxy add v4tov4 listenaddress=$wifiIp listenport=1883 connectaddress=127.0.0.1 connectport=1883

if (-not (Get-NetFirewallRule -DisplayName "Meenakshi Next App 3000" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Meenakshi Next App 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 | Out-Null
}

if (-not (Get-NetFirewallRule -DisplayName "Meenakshi MQTT 1883" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Meenakshi MQTT 1883" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1883 | Out-Null
}

Write-Host ""
Write-Host "Done. Current port proxy rules:"
netsh interface portproxy show all
Write-Host ""
Write-Host "Keep Docker running, upload the Arduino sketch, then refresh the dashboard."
