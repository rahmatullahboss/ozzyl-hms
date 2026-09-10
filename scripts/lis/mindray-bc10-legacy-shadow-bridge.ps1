# Mindray BC-10 vendor-DB shadow bridge for Ozzyl HMS LIS.
# Safety boundary: reads only an already-running LocalDB named pipe and never modifies Mindray state.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$SourceAdapter = 'mindray-bc10-legacy-db-shadow-v1'
$LocalDbInstance = if ($env:MINDRAY_LOCALDB_INSTANCE) { $env:MINDRAY_LOCALDB_INSTANCE } else { 'v11.0' }
$ExplicitLocalDbPipe = if ($env:MINDRAY_LOCALDB_PIPE) { $env:MINDRAY_LOCALDB_PIPE.Trim() } else { '' }
$MdfPath = if ($env:MINDRAY_MDF_PATH) { $env:MINDRAY_MDF_PATH } else { 'E:\Mindray\Mindray\MindrayDb.mdf' }
$BaseUrl = if ($env:HMS_LIS_BASE_URL) { $env:HMS_LIS_BASE_URL.TrimEnd('/') } else { '' }
$MachineId = if ($env:HMS_LIS_MACHINE_ID) { [int]$env:HMS_LIS_MACHINE_ID } else { 0 }
$KeyId = if ($env:HMS_LIS_KEY_ID) { $env:HMS_LIS_KEY_ID } else { '' }
$KeySecret = if ($env:HMS_LIS_KEY_SECRET) { $env:HMS_LIS_KEY_SECRET } else { '' }
$PollSeconds = if ($env:MINDRAY_POLL_SECONDS) { [Math]::Max(2, [int]$env:MINDRAY_POLL_SECONDS) } else { 5 }
$BatchLimit = if ($env:MINDRAY_BATCH_LIMIT) { [Math]::Min(500, [Math]::Max(1, [int]$env:MINDRAY_BATCH_LIMIT)) } else { 200 }
$BackfillFromId = if ($env:MINDRAY_BACKFILL_FROM_ID) { [int64]$env:MINDRAY_BACKFILL_FROM_ID } else { $null }
if ($null -ne $BackfillFromId -and $BackfillFromId -lt 0) { throw 'MINDRAY_BACKFILL_FROM_ID must be zero or greater' }
$ShadowMode = if ($env:HMS_LIS_SHADOW_MODE) { $env:HMS_LIS_SHADOW_MODE.Trim().ToLowerInvariant() -ne 'false' } else { $true }
$StateRoot = if ($env:HMS_LIS_STATE_DIR) { $env:HMS_LIS_STATE_DIR } else { Join-Path $env:ProgramData 'Ozzyl\LISBridge\MindrayBC10' }
$SpoolDir = Join-Path $StateRoot 'spool'
$CheckpointPath = Join-Path $StateRoot 'checkpoint.txt'
$ReceivePath = if ($MachineId -gt 0) { "/api/lab-machines/$MachineId/receive" } else { '' }

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
New-Item -ItemType Directory -Force -Path $SpoolDir | Out-Null

function Write-BridgeLog([string]$Level, [string]$Message) {
  $stamp = [DateTime]::UtcNow.ToString('o')
  Write-Output "$stamp [$Level] $Message"
}

function ConvertTo-Hex([byte[]]$Bytes) {
  return -join ($Bytes | ForEach-Object { $_.ToString('x2') })
}

function Get-Sha256Hex([string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ConvertTo-Hex ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value)))
  } finally {
    $sha.Dispose()
  }
}

function Get-HmacSha256Hex([string]$Secret, [string]$Value) {
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  try {
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
    return ConvertTo-Hex ($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value)))
  } finally {
    $hmac.Dispose()
  }
}

function Get-Checkpoint {
  if (-not (Test-Path -LiteralPath $CheckpointPath)) { return $null }
  $raw = (Get-Content -LiteralPath $CheckpointPath -Raw).Trim()
  $value = [int64]0
  if (-not [int64]::TryParse($raw, [ref]$value) -or $value -lt 0) {
    throw "Invalid bridge checkpoint file"
  }
  return $value
}

function Set-Checkpoint([int64]$Value) {
  $tmp = "$CheckpointPath.tmp"
  [System.IO.File]::WriteAllText($tmp, $Value.ToString(), (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $CheckpointPath -Force
}

function Get-RunningLocalDbPipe {
  if ($ExplicitLocalDbPipe) {
    $candidate = $ExplicitLocalDbPipe
    if ($candidate.StartsWith('np:', [System.StringComparison]::OrdinalIgnoreCase)) {
      $candidate = $candidate.Substring(3)
    }
    $localPipePrefix = '\\.\pipe\LOCALDB#'
    $localPipeSuffix = '\tsql\query'
    $hasExpectedShape = $candidate.StartsWith($localPipePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
      $candidate.EndsWith($localPipeSuffix, [System.StringComparison]::OrdinalIgnoreCase) -and
      $candidate.Length -gt ($localPipePrefix.Length + $localPipeSuffix.Length)
    if (-not $hasExpectedShape) {
      throw 'MINDRAY_LOCALDB_PIPE must be a local LocalDB named pipe'
    }
    $instanceTokenLength = $candidate.Length - $localPipePrefix.Length - $localPipeSuffix.Length
    $instanceToken = $candidate.Substring($localPipePrefix.Length, $instanceTokenLength)
    if ([string]::IsNullOrWhiteSpace($instanceToken) -or $instanceToken.Contains('\')) {
      throw 'MINDRAY_LOCALDB_PIPE must be a local LocalDB named pipe'
    }
    return $candidate
  }

  # `sqllocaldb info` is inspection only. The bridge deliberately has no LocalDB start operation.
  $info = & sqllocaldb info $LocalDbInstance 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { return $null }
  if ($info -notmatch '(?m)^State:\s*Running\s*$') {
    # Stable strings retained for safety-contract review: State: / Running
    return $null
  }
  if ($info -notmatch '(?m)^Instance pipe name:\s*(.+?)\s*$') {
    # Stable string retained for safety-contract review: Instance pipe name:
    return $null
  }
  return $Matches[1].Trim()
}

function Open-SqlConnection([string]$PipeName, [string]$Catalog) {
  $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $builder.DataSource = if ($PipeName.StartsWith('np:', [System.StringComparison]::OrdinalIgnoreCase)) { $PipeName } else { "np:$PipeName" }
  $builder.InitialCatalog = $Catalog
  $builder.IntegratedSecurity = $true
  $builder.ConnectTimeout = 2
  $connection = New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
  $connection.Open()
  return $connection
}

function Get-AttachedMindrayDatabase([string]$PipeName) {
  $connection = Open-SqlConnection $PipeName 'master'
  try {
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 3
    $command.CommandText = @'
SELECT TOP (1) DB_NAME(database_id)
FROM sys.master_files
WHERE LOWER(physical_name) = LOWER(@mdfPath)
  AND type_desc = 'ROWS';
'@
    [void]$command.Parameters.Add('@mdfPath', [System.Data.SqlDbType]::NVarChar, 1024)
    $command.Parameters['@mdfPath'].Value = $MdfPath
    $value = $command.ExecuteScalar()
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { return $null }
    return [string]$value
  } finally {
    $connection.Dispose()
  }
}

function Get-CurrentMaxMindrayRowId([string]$PipeName, [string]$DatabaseName) {
  $connection = Open-SqlConnection $PipeName $DatabaseName
  try {
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 3
    $command.CommandText = 'SELECT ISNULL(MAX(Id), 0) FROM dbo.tb_MachineDataDtls;'
    return [int64]$command.ExecuteScalar()
  } finally {
    $connection.Dispose()
  }
}

function Read-NewMindrayRows([string]$PipeName, [string]$DatabaseName, [int64]$Checkpoint, [int]$Limit) {
  $connection = Open-SqlConnection $PipeName $DatabaseName
  try {
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 5
    $command.CommandText = @'
SELECT TOP (@batchLimit)
       Id, InvNo, CONVERT(varchar(10), InvDate, 120) AS InvDate,
       TestCode, Parameter, AliasNo, Result, Unit, NormalValue
FROM dbo.tb_MachineDataDtls
WHERE Id > @checkpoint
ORDER BY Id ASC;
'@
    [void]$command.Parameters.Add('@batchLimit', [System.Data.SqlDbType]::Int)
    $command.Parameters['@batchLimit'].Value = $Limit
    [void]$command.Parameters.Add('@checkpoint', [System.Data.SqlDbType]::BigInt)
    $command.Parameters['@checkpoint'].Value = $Checkpoint

    $reader = $command.ExecuteReader()
    try {
      $rows = New-Object System.Collections.Generic.List[object]
      while ($reader.Read()) {
        $rows.Add([pscustomobject]@{
          Id = [int64]$reader['Id']
          InvNo = if ($reader['InvNo'] -is [DBNull]) { '' } else { [string]$reader['InvNo'] }
          InvDate = if ($reader['InvDate'] -is [DBNull]) { '' } else { [string]$reader['InvDate'] }
          TestCode = if ($reader['TestCode'] -is [DBNull]) { '' } else { [string]$reader['TestCode'] }
          Parameter = if ($reader['Parameter'] -is [DBNull]) { '' } else { [string]$reader['Parameter'] }
          AliasNo = if ($reader['AliasNo'] -is [DBNull]) { '' } else { [string]$reader['AliasNo'] }
          Result = if ($reader['Result'] -is [DBNull]) { '' } else { [string]$reader['Result'] }
          Unit = if ($reader['Unit'] -is [DBNull]) { '' } else { [string]$reader['Unit'] }
          NormalValue = if ($reader['NormalValue'] -is [DBNull]) { '' } else { [string]$reader['NormalValue'] }
        })
      }
      return @($rows)
    } finally {
      $reader.Dispose()
    }
  } finally {
    $connection.Dispose()
  }
}

function Write-SpoolPayload([string]$SourceIdentity, [string]$Body) {
  $safeName = (Get-Sha256Hex $SourceIdentity) + '.json'
  $destination = Join-Path $SpoolDir $safeName
  if (Test-Path -LiteralPath $destination) { return $destination }
  $tmp = "$destination.tmp"
  [System.IO.File]::WriteAllText($tmp, $Body, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $destination -Force
  return $destination
}

function Build-SpoolFromRows([object[]]$Rows) {
  if ($Rows.Count -eq 0) { return [int64]0 }
  $maxRowId = [int64]0
  $grouped = @{}
  foreach ($row in $Rows) {
    if ($row.Id -gt $maxRowId) { $maxRowId = $row.Id }
    if ([string]::IsNullOrWhiteSpace($row.Result) -or [string]::IsNullOrWhiteSpace($row.Parameter)) { continue }
    $groupKey = "$($row.InvDate)|$($row.InvNo)|$($row.TestCode)"
    if (-not $grouped.ContainsKey($groupKey)) { $grouped[$groupKey] = New-Object System.Collections.Generic.List[object] }
    $grouped[$groupKey].Add($row)
  }

  foreach ($groupKey in ($grouped.Keys | Sort-Object)) {
    $group = @($grouped[$groupKey] | Sort-Object Id)
    if ($group.Count -eq 0) { continue }
    $first = $group[0]
    $last = $group[$group.Count - 1]
    $results = @($group | ForEach-Object {
      $result = [ordered]@{
        testCode = [string]$_.Parameter
        value = [string]$_.Result
        resultStatus = 'F'
        completedAt = [string]$_.InvDate
      }
      if (-not [string]::IsNullOrWhiteSpace($_.AliasNo)) { $result.testName = [string]$_.AliasNo }
      if (-not [string]::IsNullOrWhiteSpace($_.Unit)) { $result.units = [string]$_.Unit }
      if (-not [string]::IsNullOrWhiteSpace($_.NormalValue)) { $result.referenceRange = [string]$_.NormalValue }
      [pscustomobject]$result
    })

    # Vendor InvNo is a date-scoped/reused legacy number, not an HMS lab order id.
    # Namespace/hash it so analyzer staging can never interpret it as a numeric HMS order id.
    $externalSpecimenIdentity = "bc10-legacy-db:$($first.InvDate):$($first.InvNo):$($first.TestCode)"
    $externalSpecimenId = "bc10-legacy-" + (Get-Sha256Hex $externalSpecimenIdentity).Substring(0, 32)
    $core = [ordered]@{
      sourceAdapter = $SourceAdapter
      specimenId = $externalSpecimenId
      results = $results
    }
    $coreJson = $core | ConvertTo-Json -Depth 8 -Compress
    $payloadHash = Get-Sha256Hex $coreJson
    $sourceIdentity = "${externalSpecimenIdentity}:$($first.Id)-$($last.Id):$payloadHash"
    $payload = [ordered]@{
      sourceAdapter = $SourceAdapter
      sourceIdentity = $sourceIdentity
      specimenId = $externalSpecimenId
      results = $results
    }
    $body = $payload | ConvertTo-Json -Depth 8 -Compress
    [void](Write-SpoolPayload $sourceIdentity $body)
  }
  return $maxRowId
}

function Send-SignedPayload([string]$Body) {
  if ($ShadowMode) { return $false }
  if ([string]::IsNullOrWhiteSpace($BaseUrl) -or $MachineId -le 0 -or [string]::IsNullOrWhiteSpace($KeyId) -or [string]::IsNullOrWhiteSpace($KeySecret)) {
    throw 'Signed LIS bridge configuration is incomplete'
  }

  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
  $nonce = [Guid]::NewGuid().ToString()
  $deliveryId = [Guid]::NewGuid().ToString()
  $bodyHash = Get-Sha256Hex $Body
  $canonical = "POST`n$ReceivePath`n$timestamp`n$nonce`n$deliveryId`n$bodyHash"
  $signature = Get-HmacSha256Hex $KeySecret $canonical

  $client = New-Object System.Net.Http.HttpClient
  try {
    $client.Timeout = [TimeSpan]::FromSeconds(10)
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, "$BaseUrl$ReceivePath")
    [void]$request.Headers.TryAddWithoutValidation('X-LIS-Key-Id', $KeyId)
    [void]$request.Headers.TryAddWithoutValidation('X-LIS-Timestamp', $timestamp)
    [void]$request.Headers.TryAddWithoutValidation('X-LIS-Nonce', $nonce)
    [void]$request.Headers.TryAddWithoutValidation('X-LIS-Delivery-Id', $deliveryId)
    [void]$request.Headers.TryAddWithoutValidation('X-LIS-Body-SHA256', $bodyHash)
    [void]$request.Headers.TryAddWithoutValidation('X-LIS-Signature', $signature)
    $request.Content = New-Object System.Net.Http.StringContent($Body, [System.Text.Encoding]::UTF8, 'application/json')
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    try {
      return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
    } finally {
      $response.Dispose()
      $request.Dispose()
    }
  } finally {
    $client.Dispose()
  }
}

function Flush-Spool {
  $files = @(Get-ChildItem -LiteralPath $SpoolDir -Filter '*.json' -File | Sort-Object Name)
  if ($files.Count -eq 0) { return }
  if ($ShadowMode) {
    Write-BridgeLog 'INFO' "Shadow mode retained $($files.Count) pending payload(s) without network delivery."
    return
  }
  foreach ($file in $files) {
    $body = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    try {
      if (Send-SignedPayload $body) {
        Remove-Item -LiteralPath $file.FullName -Force
      } else {
        Write-BridgeLog 'WARN' 'LIS delivery was not successful; payload remains durably spooled.'
        return
      }
    } catch {
      Write-BridgeLog 'WARN' 'LIS delivery failed; payload remains durably spooled.'
      return
    }
  }
}

Write-BridgeLog 'INFO' "BC-10 legacy DB bridge started; shadowMode=$ShadowMode pollSeconds=$PollSeconds batchLimit=$BatchLimit."

while ($true) {
  try {
    Flush-Spool
    $pipeName = Get-RunningLocalDbPipe
    if (-not $pipeName) {
      Write-BridgeLog 'INFO' 'Mindray LocalDB is not already running; bridge is idle and will not start it.'
      Start-Sleep -Seconds $PollSeconds
      continue
    }
    $databaseName = Get-AttachedMindrayDatabase $pipeName
    if (-not $databaseName) {
      Write-BridgeLog 'INFO' 'Mindray database is not already attached; bridge is idle.'
      Start-Sleep -Seconds $PollSeconds
      continue
    }
    $checkpoint = Get-Checkpoint
    if ($null -eq $checkpoint) {
      if ($null -ne $BackfillFromId) {
        $checkpoint = [int64]$BackfillFromId
        Set-Checkpoint $checkpoint
        Write-BridgeLog 'INFO' "Explicit historical backfill checkpoint initialized at row $checkpoint."
      } else {
        $checkpoint = Get-CurrentMaxMindrayRowId $pipeName $databaseName
        Set-Checkpoint $checkpoint
        Write-BridgeLog 'INFO' "Baseline initialized at current source row $checkpoint; existing clinical history was not replayed."
        Start-Sleep -Seconds $PollSeconds
        continue
      }
    }
    $rows = @(Read-NewMindrayRows $pipeName $databaseName $checkpoint $BatchLimit)
    if ($rows.Count -gt 0) {
      $nextCheckpoint = Build-SpoolFromRows $rows
      if ($nextCheckpoint -gt $checkpoint) {
        # All payload files are durable before the checkpoint moves past their source rows.
        Set-Checkpoint $nextCheckpoint
        Write-BridgeLog 'INFO' "Spooled $($rows.Count) new result row(s); checkpoint=$nextCheckpoint."
      }
      Flush-Spool
    }
  } catch {
    Write-BridgeLog 'WARN' 'Read/spool cycle failed safely; Mindray state was not modified.'
  }
  Start-Sleep -Seconds $PollSeconds
}
