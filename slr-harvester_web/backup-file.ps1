param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

$ErrorActionPreference = 'Stop'

$webRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupRoot = Join-Path $webRoot 'backups'

if (-not (Test-Path -LiteralPath $FilePath)) {
  throw "File not found: $FilePath"
}

$resolved = (Resolve-Path -LiteralPath $FilePath).Path
$fullWebRoot = (Resolve-Path -LiteralPath $webRoot).Path

if (-not $resolved.StartsWith($fullWebRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Only files inside slr-harvester_web can be backed up."
}

$relativePath = $resolved.Substring($fullWebRoot.Length).TrimStart('\\')
$relativeDir = Split-Path -Parent $relativePath
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($resolved)
$extension = [System.IO.Path]::GetExtension($resolved)
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

$targetDir = if ([string]::IsNullOrWhiteSpace($relativeDir)) {
  $backupRoot
} else {
  Join-Path $backupRoot $relativeDir
}

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

$targetFile = Join-Path $targetDir ("{0}__{1}{2}" -f $baseName, $stamp, $extension)
Copy-Item -LiteralPath $resolved -Destination $targetFile -Force

Write-Output "Backup created: $targetFile"
