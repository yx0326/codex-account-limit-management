$ErrorActionPreference = "Stop"
# Windows UI Automation: intentionally narrow target and button-name allowlist.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$procs = Get-Process | Where-Object { $_.ProcessName -match 'Codex|ChatGPT' -and $_.MainWindowHandle -ne 0 }
if (-not $procs) { Write-Output "未找到带主窗口的 Codex/ChatGPT 进程"; exit 2 }
$clicked = $false
foreach ($p in $procs) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
    $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
    foreach ($b in $buttons) {
      $name = $b.Current.Name
      if ($name -match '^(Stop|Cancel|停止|取消|中断)(\s|$)') {
        $pattern = $null
        if ($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
          $pattern.Invoke(); Write-Output "已点击按钮：$name"; $clicked=$true; break
        }
      }
    }
  } catch { Write-Output ("UIA 错误："+$_.Exception.Message) }
  if ($clicked) { break }
}
if (-not $clicked) { Write-Output "未找到可安全触发的停止/取消按钮；未执行任何操作"; exit 3 }
exit 0