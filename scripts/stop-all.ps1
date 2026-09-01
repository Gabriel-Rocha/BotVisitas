# Encerra BotVisitas: dashboard, bot CLI e Chromium órfãos do Puppeteer.
param(
  [switch]$Quiet
)

function Log($msg) {
  if (-not $Quiet) { Write-Host $msg }
}

$rootHint = 'BotVisitas'
$killedNode = 0
$killedChrome = 0

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match [regex]::Escape($rootHint) -and
      $_.CommandLine -match 'dashboard\\server|src\\index|src/index|run dev'
    )
  } |
  ForEach-Object {
    Log "Matando node pid=$($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $killedNode++
  }

Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'remote-debugging-port' -or
      $_.CommandLine -match 'disable-blink-features=AutomationControlled'
    )
  } |
  ForEach-Object {
    Log "Matando chrome pid=$($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $killedChrome++
  }

if (-not $Quiet) {
  if ($killedNode -eq 0 -and $killedChrome -eq 0) {
    Write-Host 'Nenhum processo BotVisitas/Chromium do bot encontrado.'
  } else {
    Write-Host "OK node=$killedNode chrome=$killedChrome"
  }
}

exit 0
