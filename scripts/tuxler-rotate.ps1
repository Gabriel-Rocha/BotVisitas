# Rotaciona IP residencial no TuxlerVPN (Windows).
# Tuxler e Electron: UI Automation nao expoe botoes (arvore vazia).
# Modo padrao "coords": clique no botao Reload via coordenadas relativas da janela.
#
# Uso (Windows bloqueia .ps1 sem Bypass — igual ao bot em tuxler.js):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tuxler-rotate.ps1 -RotateMode restart -Country de
#   npm run tuxler:rotate -- -RotateMode restart -Country de
# Modos: restart (mata processo + reconecta) | coords | uia | skip
# restart = reinicia so o helper (como taskKill.py); mantem tuxlerVPN aberto

param(
  [string]$Country = "",
  [string]$ExePath = "C:\Program Files (x86)\tuxlerVPN\tuxlerVPN.exe",
  [string]$HelperPath = "",
  [int]$TimeoutSec = 90,
  [ValidateSet('coords', 'uia', 'skip', 'restart')]
  [string]$RotateMode = "restart",
  [double]$ClickRelX = 0.50,
  [double]$ClickRelY = 0.68,
  [double]$ActivateRelX = 0.50,
  [double]$ActivateRelY = 0.58
)

$ErrorActionPreference = "Stop"

$ReloadPatterns = @(
  '(?i)reload\s+to\s+next',
  '(?i)reload',
  '(?i)next\s+nearby',
  '(?i)switch\s+location',
  '(?i)change\s+ip',
  '(?i)recarregar',
  '(?i)proxim',
  '(?i)nearby',
  '(?i)nova\s+local',
  '(?i)new\s+location',
  '(?i)rotate',
  '(?i)novo\s+ip',
  '(?i)new\s+ip'
)

function Get-Egress {
  try {
    $r = Invoke-RestMethod -Uri "http://ip-api.com/json/?fields=query,countryCode" -TimeoutSec 12
    return @{ ip = [string]$r.query; cc = [string]$r.countryCode }
  } catch {
    return $null
  }
}

$ActivatePatterns = @(
  '(?i)^activate$',
  '(?i)activ',
  '(?i)ativar',
  '(?i)^connect$',
  '(?i)conectar',
  '(?i)enable',
  '(?i)residential',
  '(?i)start\s+vpn',
  '(?i)turn\s+on'
)

function Stop-TuxlerHelperProcesses {
  $names = @(
    'ExtensionHelperApp',
    'ExtensionHelperAppManager',
    'ExtensionHelperAppHelperTuxler'
  )
  foreach ($name in $names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Write-Host "killed=$name pid=$($_.Id)"
      } catch {
        # ignore
      }
    }
  }
  Start-Sleep -Seconds 2
}

function Stop-TuxlerProcesses {
  $names = @(
    'tuxlerVPN',
    'ExtensionHelperApp',
    'ExtensionHelperAppManager',
    'ExtensionHelperAppHelperTuxler'
  )
  foreach ($name in $names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Write-Host "killed=$name pid=$($_.Id)"
      } catch {
        # ignore
      }
    }
  }
  Start-Sleep -Seconds 2
}

function Resolve-TuxlerHelperPath {
  $candidates = @()
  if ($HelperPath) { $candidates += $HelperPath }

  if ($ExePath) {
    $exeDir = Split-Path -Parent $ExePath
    $candidates += @(
      (Join-Path $exeDir 'ExtensionHelperAppHelperTuxler.exe'),
      (Join-Path $exeDir 'ExtensionHelperAppManager.exe'),
      (Join-Path $exeDir 'ExtensionHelperApp.exe')
    )
  }

  $candidates += @(
    'C:\Program Files (x86)\tuxlerVPN\ExtensionHelperAppHelperTuxler.exe',
    'C:\Program Files (x86)\TuxlerChromeExtensionHelperApp\ExtensionHelperAppManager.exe'
  )

  foreach ($p in ($candidates | Select-Object -Unique)) {
    if ($p -and (Test-Path -LiteralPath $p)) {
      return $p
    }
  }
  return $null
}

function Start-TuxlerHelper {
  $helper = Resolve-TuxlerHelperPath
  if (-not $helper) {
    Write-Host "helper=skip (nao encontrado; aguardando respawn pelo tuxlerVPN)"
    return $false
  }
  Write-Host "helper=$helper"
  Start-Process -FilePath $helper | Out-Null
  Write-Host "started=$([System.IO.Path]::GetFileName($helper))"
  return $true
}

function Start-TuxlerStack {
  Start-TuxlerHelper
  if (Test-Path -LiteralPath $ExePath) {
    $vpn = Get-Process -Name 'tuxlerVPN' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $vpn) {
      Start-Sleep -Seconds 1
      Start-Process -FilePath $ExePath | Out-Null
      Write-Host "started=tuxlerVPN"
    } else {
      Write-Host "keep=tuxlerVPN pid=$($vpn.Id)"
    }
  }
}

function Invoke-TuxlerStartupUi($proc) {
  if (-not $proc) { return $false }

  try {
    Focus-TuxlerWindow $proc
  } catch {
    Write-Host "activate=skip (sem janela): $($_.Exception.Message)"
    return $false
  }

  try {
    $window = Get-TuxlerWindowUia $proc
    if ($window) {
      $clicked = Click-ByName $window $ActivatePatterns
      if ($clicked) {
        Write-Host "clicked=activate uia name=$clicked"
        return $true
      }
    }
  } catch {
    Write-Host "activate=uia-fail $($_.Exception.Message)"
  }

  Click-TuxlerRelative $proc $ActivateRelX $ActivateRelY
  Write-Host "clicked=activate coords rel=$ActivateRelX,$ActivateRelY"
  return $true
}

function Wait-TuxlerConnected {
  param(
    [hashtable]$Before,
    [int]$DeadlineSec,
    [switch]$AllowSameIp
  )
  $deadline = (Get-Date).AddSeconds($DeadlineSec)
  $want = $Country.Trim().ToLower()
  $startupClicks = 0
  $nextUiAt = (Get-Date)

  while ((Get-Date) -lt $deadline) {
    $proc = Get-Process -Name 'tuxlerVPN' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc -and (Test-Path -LiteralPath $ExePath)) {
      Start-Process -FilePath $ExePath | Out-Null
      Write-Host "started=tuxlerVPN (ausente)"
      Start-Sleep -Seconds 3
      $proc = Get-Process -Name 'tuxlerVPN' -ErrorAction SilentlyContinue | Select-Object -First 1
    }

    if ($proc -and (Get-Date) -ge $nextUiAt -and $startupClicks -lt 4) {
      $startupClicks += 1
      $nextUiAt = (Get-Date).AddSeconds(12)
      Invoke-TuxlerStartupUi $proc | Out-Null
      Start-Sleep -Seconds 2
    }

    if ($proc) {
      $egress = Get-Egress
      if ($egress -and $egress.ip) {
        $ipChanged = $Before -and $Before.ip -and ($egress.ip -ne $Before.ip)
        $countryOk = (-not $want) -or ($egress.cc.ToLower() -eq $want)
        if ($ipChanged -or $countryOk) {
          return $egress
        }
        if ($AllowSameIp) {
          return $egress
        }
        if (-not $Before -or -not $Before.ip) {
          return $egress
        }
      }
    }
    Start-Sleep -Seconds 3
  }
  $final = Get-Egress
  if ($final -and $final.ip) {
    return $final
  }
  return $null
}

function Invoke-TuxlerRestart {
  param([hashtable]$Before)
  Write-Host "restart=begin ip=$($Before.ip) cc=$($Before.cc) (helper-only, mantem tuxlerVPN)"
  Stop-TuxlerHelperProcesses
  Start-TuxlerHelper
  $proc = Get-Process -Name 'tuxlerVPN' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc) {
    Invoke-TuxlerStartupUi $proc | Out-Null
  } else {
    Start-TuxlerStack
  }
  $after = Wait-TuxlerConnected -Before $Before -DeadlineSec $TimeoutSec -AllowSameIp
  if (-not $after -or -not $after.ip) {
    throw "Tuxler restart: sem IP de egress em ${TimeoutSec}s (clique Activate no app ou ajuste TUXLER_ACTIVATE_X/Y)"
  }
  Write-Host "restart=ok ip=$($after.ip) cc=$($after.cc)"
  return $after
}

function Ensure-Tuxler {
  $proc = Get-Process -Name "tuxlerVPN" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc) { return $proc }

  if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "Tuxler nao encontrado em: $ExePath (ajuste TUXLER_EXE no .env)"
  }

  Start-Process -FilePath $ExePath | Out-Null
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $proc = Get-Process -Name "tuxlerVPN" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { return $proc }
  }

  $proc = Get-Process -Name "tuxlerVPN" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { throw "Tuxler nao iniciou a tempo" }
  return $proc
}

function Initialize-Win32 {
  if (-not ("TuxlerWin32" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct TuxlerRect {
  public int Left; public int Top; public int Right; public int Bottom;
}
public class TuxlerWin32 {
  public const int SW_RESTORE = 9;
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out TuxlerRect lpRect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
  public const int MOUSEEVENTF_LEFTDOWN = 0x02;
  public const int MOUSEEVENTF_LEFTUP = 0x04;
  public static void LeftClick(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  }
}
"@
  }
}

function Focus-TuxlerWindow($proc) {
  Initialize-Win32
  $proc.Refresh()
  if ($proc.MainWindowHandle -eq [IntPtr]::Zero) {
    Start-Sleep -Seconds 2
    $proc.Refresh()
  }
  if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
    [TuxlerWin32]::ShowWindow($proc.MainWindowHandle, [TuxlerWin32]::SW_RESTORE) | Out-Null
    [TuxlerWin32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 900
  } else {
    throw "Tuxler sem janela visivel (MainWindowHandle=0) - abra o app na area de trabalho"
  }
}

function Get-TuxlerWindowRect($proc) {
  Initialize-Win32
  $proc.Refresh()
  if ($proc.MainWindowHandle -eq [IntPtr]::Zero) {
    throw "Tuxler sem janela visivel - abra o app e conecte em modo Residential"
  }
  $rect = New-Object TuxlerRect
  if (-not [TuxlerWin32]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) {
    throw "Nao foi possivel ler o retangulo da janela Tuxler"
  }
  return $rect
}

function Click-TuxlerRelative($proc, [double]$relX, [double]$relY) {
  $rx = [Math]::Max(0.05, [Math]::Min(0.95, $relX))
  $ry = [Math]::Max(0.05, [Math]::Min(0.95, $relY))
  $rect = Get-TuxlerWindowRect $proc
  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $x = [int]($rect.Left + ($width * $rx))
  $y = [int]($rect.Top + ($height * $ry))
  [TuxlerWin32]::LeftClick($x, $y)
  Write-Host "clicked=coords x=$x y=$y rel=$rx,$ry size=${width}x${height}"
}

function Get-TuxlerWindowUia($proc) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $proc.Id
  )
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
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
    $lower = $name.ToLowerInvariant()
    foreach ($pat in $patterns) {
      if ($name -match $pat -or $lower -match $pat) {
        if (Invoke-UiElement $el) { return $name }
      }
    }
  }
  return $null
}

function Invoke-TuxlerReload($proc) {
  Focus-TuxlerWindow $proc

  if ($RotateMode -eq 'skip') {
    Write-Host "clicked=skip"
    return
  }

  if ($RotateMode -eq 'uia') {
    $window = Get-TuxlerWindowUia $proc
    if (-not $window) {
      throw "Janela UIA do Tuxler nao encontrada"
    }
    $clicked = Click-ByName $window $ReloadPatterns
    if (-not $clicked) {
      throw "Botao UIA nao encontrado (Tuxler Electron?) - use TUXLER_ROTATE_MODE=coords"
    }
    Write-Host "clicked=$clicked"
    return
  }

  # coords (padrao): botao grande "Reload to Next Nearby Location" ~centro-inferior
  Click-TuxlerRelative $proc $ClickRelX $ClickRelY
}

if ($RotateMode -eq 'skip') {
  $current = Get-Egress
  if ($current -and $current.ip) {
    Write-Output "OK ip=$($current.ip) cc=$($current.cc) mode=skip"
    exit 0
  }
  throw "TUXLER_ROTATE_MODE=skip mas sem IP de egress"
}

$before = Get-Egress

if ($RotateMode -eq 'restart') {
  $after = Invoke-TuxlerRestart -Before $before
  Write-Output "OK ip=$($after.ip) cc=$($after.cc) mode=restart"
  exit 0
}

$proc = Ensure-Tuxler
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$attempts = 0

while ((Get-Date) -lt $deadline -and $attempts -lt 2) {
  $attempts += 1
  $yCandidates = @(
    $ClickRelY,
    0.58,
    0.64,
    0.70,
    0.76,
    0.82
  ) | Select-Object -Unique
  $yPick = $yCandidates[([Math]::Min($attempts, $yCandidates.Length) - 1)]
  Focus-TuxlerWindow $proc
  if ($RotateMode -eq 'uia') {
    Invoke-TuxlerReload $proc
  } else {
    Click-TuxlerRelative $proc $ClickRelX $yPick
  }
  Start-Sleep -Seconds 8

  $after = Get-Egress
  if ($after -and $after.ip) {
    $ipChanged = $before -and $before.ip -and ($after.ip -ne $before.ip)
    $cc = $Country.Trim().ToLower()
    $countryOk = (-not $cc) -or ($after.cc.ToLower() -eq $cc)

    if ($ipChanged -or $countryOk) {
      Write-Output "OK ip=$($after.ip) cc=$($after.cc) attempts=$attempts mode=$RotateMode"
      exit 0
    }
  }
}

$final = Get-Egress
if ($final -and $final.ip) {
  Write-Output "OK ip=$($final.ip) cc=$($final.cc) attempts=$attempts mode=$RotateMode (sem mudanca confirmada)"
  exit 0
}

throw "Nao foi possivel rotacionar o Tuxler dentro de ${TimeoutSec}s (mode=$RotateMode)"
