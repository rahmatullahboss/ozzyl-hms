param(
  [string]$TaskName = "OzzylHMSWorkstation"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$bash = Get-Command bash.exe -ErrorAction SilentlyContinue
if (-not $bash) {
  $candidates = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files\Git\usr\bin\bash.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $bash = Get-Item $candidate
      break
    }
  }
}

if (-not $bash) {
  throw "Git Bash (bash.exe) is required for the current workstation runtime launcher. Install Git for Windows first."
}

$bashPath = $bash.Source
if (-not $bashPath) { $bashPath = $bash.FullName }

$escapedRoot = $Root.Replace("'", "'\''")
$command = "cd '$escapedRoot' && exec bash scripts/workstation-node/run.sh"
$arguments = "-lc `"$command`""

$action = New-ScheduledTaskAction -Execute $bashPath -Argument $arguments -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 20 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Ozzyl HMS per-workstation offline runtime and cloud sync" `
  -Force | Out-Null

Write-Host "Installed Windows autostart task: $TaskName"
Write-Host "Repository: $Root"
Write-Host "The node will start at user logon and restart automatically after failure."
