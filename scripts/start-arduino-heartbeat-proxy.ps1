$ErrorActionPreference = "Stop"

$listenIp = [System.Net.IPAddress]::Parse("192.168.1.112")
$listenPort = 3000
$targetHost = "127.0.0.1"
$targetPort = 3000

function Read-HttpRequestBytes {
  param([System.Net.Sockets.NetworkStream] $stream)

  $bytes = New-Object System.Collections.Generic.List[byte]
  $buffer = New-Object byte[] 1
  $headerText = ""

  while ($true) {
    $read = $stream.Read($buffer, 0, 1)
    if ($read -le 0) {
      break
    }

    $bytes.Add($buffer[0])
    if ($bytes.Count -ge 4) {
      $count = $bytes.Count
      if (
        $bytes[$count - 4] -eq 13 -and
        $bytes[$count - 3] -eq 10 -and
        $bytes[$count - 2] -eq 13 -and
        $bytes[$count - 1] -eq 10
      ) {
        $headerText = [System.Text.Encoding]::ASCII.GetString($bytes.ToArray())
        break
      }
    }
  }

  $contentLength = 0
  foreach ($line in $headerText -split "`r`n") {
    if ($line -match '^Content-Length:\s*(\d+)') {
      $contentLength = [int]$matches[1]
    }
  }

  if ($contentLength -gt 0) {
    $body = New-Object byte[] $contentLength
    $offset = 0
    while ($offset -lt $contentLength) {
      $read = $stream.Read($body, $offset, $contentLength - $offset)
      if ($read -le 0) {
        break
      }
      $offset += $read
    }

    for ($index = 0; $index -lt $offset; $index++) {
      $bytes.Add($body[$index])
    }
  }

  return $bytes.ToArray()
}

function Forward-HttpRequest {
  param([byte[]] $requestBytes)

  $target = [System.Net.Sockets.TcpClient]::new()
  $target.Connect($targetHost, $targetPort)

  try {
    $targetStream = $target.GetStream()
    $targetStream.Write($requestBytes, 0, $requestBytes.Length)
    $targetStream.Flush()

    $response = New-Object System.Collections.Generic.List[byte]
    $buffer = New-Object byte[] 8192

    do {
      $read = $targetStream.Read($buffer, 0, $buffer.Length)
      if ($read -gt 0) {
        for ($index = 0; $index -lt $read; $index++) {
          $response.Add($buffer[$index])
        }
      }
    } while ($read -gt 0 -and $target.Connected)

    return $response.ToArray()
  } finally {
    $target.Close()
  }
}

$listener = [System.Net.Sockets.TcpListener]::new($listenIp, $listenPort)
$listener.Start()

Write-Host "Arduino heartbeat proxy listening on 192.168.1.112:3000 -> 127.0.0.1:3000"
Write-Host "Keep this window open."

while ($true) {
  $client = $listener.AcceptTcpClient()

  try {
    $stream = $client.GetStream()
    $requestBytes = Read-HttpRequestBytes -stream $stream

    if ($requestBytes.Length -gt 0) {
      $requestText = [System.Text.Encoding]::ASCII.GetString($requestBytes)
      $firstLine = ($requestText -split "`r`n")[0]
      Write-Host $firstLine

      $responseBytes = Forward-HttpRequest -requestBytes $requestBytes
      $stream.Write($responseBytes, 0, $responseBytes.Length)
      $stream.Flush()
    }
  } catch {
    Write-Host "Proxy error: $($_.Exception.Message)"
  } finally {
    $client.Close()
  }
}
