$ErrorActionPreference = "Stop"

$listenAddress = "192.168.1.112"
$mappings = @(
  @{ ListenPort = 3000; TargetHost = "127.0.0.1"; TargetPort = 3000 },
  @{ ListenPort = 1883; TargetHost = "127.0.0.1"; TargetPort = 1883 }
)

function Copy-Stream {
  param(
    [System.IO.Stream] $From,
    [System.IO.Stream] $To
  )

  $buffer = New-Object byte[] 8192
  try {
    while ($true) {
      $read = $From.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) {
        break
      }
      $To.Write($buffer, 0, $read)
      $To.Flush()
    }
  } catch {
  }
}

function Start-Forwarder {
  param(
    [string] $ListenAddress,
    [int] $ListenPort,
    [string] $TargetHost,
    [int] $TargetPort
  )

  $ip = [System.Net.IPAddress]::Parse($ListenAddress)
  $listener = [System.Net.Sockets.TcpListener]::new($ip, $ListenPort)
  $listener.Start()
  Write-Host "Forwarding $ListenAddress`:$ListenPort -> $TargetHost`:$TargetPort"

  while ($true) {
    $client = $listener.AcceptTcpClient()

    Start-Job -ArgumentList $client, $TargetHost, $TargetPort -ScriptBlock {
      param($client, $targetHost, $targetPort)

      function Copy-Stream {
        param(
          [System.IO.Stream] $From,
          [System.IO.Stream] $To
        )

        $buffer = New-Object byte[] 8192
        try {
          while ($true) {
            $read = $From.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) {
              break
            }
            $To.Write($buffer, 0, $read)
            $To.Flush()
          }
        } catch {
        }
      }

      $target = [System.Net.Sockets.TcpClient]::new()
      try {
        $target.Connect($targetHost, $targetPort)

        $clientStream = $client.GetStream()
        $targetStream = $target.GetStream()

        $a = [powershell]::Create().AddScript({
          param($from, $to)
          $buffer = New-Object byte[] 8192
          try {
            while ($true) {
              $read = $from.Read($buffer, 0, $buffer.Length)
              if ($read -le 0) { break }
              $to.Write($buffer, 0, $read)
              $to.Flush()
            }
          } catch {}
        }).AddArgument($clientStream).AddArgument($targetStream)

        $b = [powershell]::Create().AddScript({
          param($from, $to)
          $buffer = New-Object byte[] 8192
          try {
            while ($true) {
              $read = $from.Read($buffer, 0, $buffer.Length)
              if ($read -le 0) { break }
              $to.Write($buffer, 0, $read)
              $to.Flush()
            }
          } catch {}
        }).AddArgument($targetStream).AddArgument($clientStream)

        $ra = $a.BeginInvoke()
        $rb = $b.BeginInvoke()

        while (-not $ra.IsCompleted -and -not $rb.IsCompleted) {
          Start-Sleep -Milliseconds 100
        }
      } finally {
        $client.Close()
        $target.Close()
      }
    } | Out-Null
  }
}

Write-Host "Starting Arduino port forwarders. Keep this window open."
foreach ($mapping in $mappings) {
  Start-Job -ArgumentList $listenAddress, $mapping.ListenPort, $mapping.TargetHost, $mapping.TargetPort -ScriptBlock ${function:Start-Forwarder} | Out-Null
}

Get-Job | Format-Table -AutoSize
while ($true) {
  Start-Sleep -Seconds 60
}
