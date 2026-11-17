$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

# Keep this script ASCII-only so legacy Windows PowerShell code pages cannot corrupt its syntax.
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    $targetProcesses = Get-Process | Where-Object {
        $_.ProcessName -match '(?i)Codex|ChatGPT' -and $_.MainWindowHandle -ne 0
    }

    if (-not $targetProcesses) {
        Write-Output "ERROR: No Codex/ChatGPT process with a main window was found."
        exit 2
    }

    # Stop labels in English and Chinese. Unicode escapes avoid source-file encoding issues.
    $stopNamePattern = '^(Stop|Cancel|\u505c\u6b62|\u53d6\u6d88|\u4e2d\u65ad)(\s|$)'
    $clicked = $false
    $seenButtons = @()

    foreach ($processItem in $targetProcesses) {
        try {
            $root = [System.Windows.Automation.AutomationElement]::FromHandle($processItem.MainWindowHandle)
            if ($null -eq $root) { continue }

            $condition = [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Button
            )
            $buttons = $root.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                $condition
            )

            foreach ($button in $buttons) {
                try {
                    $name = [string]$button.Current.Name
                    if ($name) { $seenButtons += $name }

                    if ($name -match $stopNamePattern -and
                        $button.Current.IsEnabled -and
                        -not $button.Current.IsOffscreen) {

                        $invokePattern = $null
                        $hasInvoke = $button.TryGetCurrentPattern(
                            [System.Windows.Automation.InvokePattern]::Pattern,
                            [ref]$invokePattern
                        )

                        if ($hasInvoke -and $null -ne $invokePattern) {
                            $invokePattern.Invoke()
                            Write-Output ("SUCCESS: Invoked stop button. Name=" + $name)
                            $clicked = $true
                            break
                        }
                    }
                } catch {
                    Write-Output ("WARN: Button inspection failed: " + $_.Exception.Message)
                }
            }
        } catch {
            Write-Output ("WARN: Window inspection failed: " + $_.Exception.Message)
        }

        if ($clicked) { break }
    }

    if (-not $clicked) {
        Write-Output "ERROR: No visible, enabled Stop/Cancel button was found. No action was taken."
        if ($seenButtons.Count -gt 0) {
            Write-Output ("DEBUG: Visible button names: " + (($seenButtons | Select-Object -Unique | Select-Object -First 20) -join " | "))
        } else {
            Write-Output "DEBUG: UI Automation returned no button names."
        }
        exit 3
    }

    exit 0
}
catch {
    Write-Output ("FATAL: UI Automation script failed: " + $_.Exception.Message)
    exit 10
}
