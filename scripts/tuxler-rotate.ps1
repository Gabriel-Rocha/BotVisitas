# Rotaciona IP residencial no TuxlerVPN (Windows).
# Uso: powershell -File scripts/tuxler-rotate.ps1 [-Country de] [-ExePath "..."]

param(
  [string]$Country = "",
  [string]$ExePath = "C:\Program Files (x86)\tuxlerVPN\tuxlerVPN.exe",
  [int]$TimeoutSec = 90
)

$ErrorActionPreference = "Stop"

$CountryNames = @{
  au = "Australia"
  de = "Germany"
  us = "United States"
  gb = "United Kingdom"
  ca = "Canada"
  fr = "France"
  nl = "Netherlands"
  it = "Italy"
  es = "Spain"
  br = "Brazil"
}

function Get-Egress {
  try {
    $r = Invoke-RestMethod -Uri "http://ip-api.com/json/?fields=query,countryCode" -TimeoutSec 12
    return @{ ip = [string]$r.query; cc = [string]$r.countryCode }
  } catch {
    return $null
  }
}

function Ensure-Tuxler {
  $proc = Get-Process -Name "tuxlerVPN" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc) { return $proc }

  if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "Tuxler não encontrado em: $ExePath (ajuste TUXLER_EXE no .env)"
  }

  Start-Process -FilePath $ExePath | Out-Null
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $proc = Get-Process -Name "tuxlerVPN" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { return $proc }
  }

  $proc = Get-Process -Name "tuxlerVPN" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { throw "Tuxler não iniciou a tempo" }
  return $proc
}

function Focus-TuxlerWindow($proc) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TuxlerWin32 {
  public const int SW_RESTORE = 9;
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction SilentlyContinue

  if ($proc.MainWindowHandle -eq [IntPtr]::Zero) {
    Start-Sleep -Seconds 2
  }
  if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
    [TuxlerWin32]::ShowWindow($proc.MainWindowHandle, [TuxlerWin32]::SW_RESTORE) | Out-Null
    [TuxlerWin32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 700
  }
}

function Invoke-UiElement($element) {
  $invoke = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  if ($invoke) {
    $invoke.Invoke()
    return $true
  }
  return $false
}

function Click-ByName($root, [string[]]$patterns) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  $all = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )

  foreach ($el in $all) {
    $name = [string]$el.Current.Name
    if (-not $name) { continue }
    foreach ($pat in $patterns) {
      if ($name -match $pat) {
        if (Invoke-UiElement $el) { return $name }
      }
    }
  }
  return $null
}

function Select-CountryIfNeeded($root, [string]$iso2) {
  if (-not $iso2) { return }
  $cc = $iso2.Trim().ToLower()
  if (-not $CountryNames.ContainsKey($cc)) { return }

  $label = $CountryNames[$cc]
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  $all = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )

  foreach ($el in $all) {
    $name = [string]$el.Current.Name
    if ($name -eq $label -or $name -match [regex]::Escape($label)) {
      if (Invoke-UiElement $el) {
        Write-Host "country=$label"
        Start-Sleep -Seconds 4
        return
      }
    }
  }
}

function Invoke-TuxlerReload($proc) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  Focus-TuxlerWindow $proc

  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $proc.Id
  )
  $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
  if (-not $window) {
    throw "Janela do Tuxler não encontrada — abra o app e conecte em modo Residential"
  }

  $cc = $Country.Trim().ToLower()
  if ($cc) {
    Select-CountryIfNeeded $window $cc
  }

  $clicked = Click-ByName $window @(
    'Reload to Next Nearby Location',
    'Reload',
    'Next Nearby',
    'Switch Location',
    'Change IP'
  )

  if (-not $clicked) {
    throw "Botão de rotação não encontrado no Tuxler — clique em 'Reload to Next Nearby Location' manualmente"
  }

  Write-Host "clicked=$clicked"
}

$before = Get-Egress
$proc = Ensure-Tuxler
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$attempts = 0

while ((Get-Date) -lt $deadline -and $attempts -lt 4) {
  $attempts += 1
  Invoke-TuxlerReload $proc
  Start-Sleep -Seconds 10

  $after = Get-Egress
  if ($after -and $after.ip) {
    $ipChanged = $before -and $before.ip -and ($after.ip -ne $before.ip)
    $cc = $Country.Trim().ToLower()
    $countryOk = (-not $cc) -or ($after.cc.ToLower() -eq $cc)

    if ($ipChanged -or $countryOk) {
      Write-Output "OK ip=$($after.ip) cc=$($after.cc) attempts=$attempts"
      exit 0
    }
  }
}

$final = Get-Egress
if ($final -and $final.ip) {
  Write-Output "OK ip=$($final.ip) cc=$($final.cc) attempts=$attempts (sem mudança confirmada)"
  exit 0
}

throw "Não foi possível rotacionar o Tuxler dentro de ${TimeoutSec}s"
