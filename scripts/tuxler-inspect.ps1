# Diagnostico da arvore UI do Tuxler (UI Automation)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$proc = Get-Process -Name 'tuxlerVPN' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  Write-Output 'ERRO: processo tuxlerVPN nao encontrado'
  exit 1
}

Write-Output "proc=$($proc.Id) title=$($proc.MainWindowTitle) handle=$($proc.MainWindowHandle)"

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $proc.Id
)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $win) {
  $nameCond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $proc.MainWindowTitle
    )),
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Window
    ))
  )
  $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $nameCond)
}
if (-not $win) {
  Write-Output 'ERRO: janela UIA nao encontrada'
  exit 1
}

$all = $win.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition
)
Write-Output "elements=$($all.Count)"

$n = 0
foreach ($el in $all) {
  $name = [string]$el.Current.Name
  $ctype = $el.Current.ControlType.ProgrammaticName
  $aid = [string]$el.Current.AutomationId
  $cls = [string]$el.Current.ClassName
  $help = [string]$el.Current.HelpText
  if ($name -or $aid -or $help) {
    Write-Output "[$n] type=$ctype name='$name' id='$aid' help='$help' class='$cls'"
    $n++
  }
  if ($n -ge 80) { break }
}

if ($n -eq 0) {
  Write-Output 'AVISO: nenhum elemento com Name/AutomationId/HelpText — app pode ser Electron sem UIA exposta'
}
