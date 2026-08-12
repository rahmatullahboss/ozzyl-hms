param(
  [string]$TaskName = "OzzylHMSWorkstation",
  [int]$Port = 8787
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
$command = "cd '$escapedRoot' && HMS_WORKSTATION_PORT=$Port exec bash scripts/workstation-node/run.sh"
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

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Ozzyl HMS Offline.url"
@"
[InternetShortcut]
URL=http://127.0.0.1:$Port
IconIndex=0
"@ | Set-Content -Path $shortcutPath -Encoding ASCII

Write-Host "Installed Windows autostart task: $TaskName"
Write-Host "Repository: $Root"
Write-Host "Local HMS shortcut: $shortcutPath"
Write-Host "The node will start at user logon and restart automatically after failure."
