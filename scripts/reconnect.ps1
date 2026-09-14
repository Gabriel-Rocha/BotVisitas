# Reconecta o adaptador de rede ativo para forçar novo lease DHCP / IP público (CGNAT).
# Requer execução elevada em alguns adapters. O bot chama no máximo 1x / 2 dias.

$ErrorActionPreference = 'Stop'

$adapter = Get-NetAdapter |
  Where-Object { $_.Status -eq 'Up' -and $_.HardwareInterface -eq $true } |
  Sort-Object -Property LinkSpeed -Descending |
  Select-Object -First 1

if (-not $adapter) {
  Write-Error 'Nenhum adaptador Up encontrado'
  exit 1
}

$name = $adapter.Name
Write-Host "Reconectando adaptador: $name"

Disable-NetAdapter -Name $name -Confirm:$false
Start-Sleep -Seconds 4
Enable-NetAdapter -Name $name -Confirm:$false

# Aguarda link voltar
$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Seconds 2
  $current = Get-NetAdapter -Name $name -ErrorAction SilentlyContinue
} while ($current -and $current.Status -ne 'Up' -and (Get-Date) -lt $deadline)

if (-not $current -or $current.Status -ne 'Up') {
  Write-Error "Adaptador $name nao voltou Up a tempo"
  exit 2
}

Write-Host "Adaptador $name Up novamente"
exit 0
