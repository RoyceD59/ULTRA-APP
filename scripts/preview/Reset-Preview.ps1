param([switch]$DropTestData)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$compose = Join-Path $repository 'infra/preview/compose.yaml'
if (-not (Test-Path -LiteralPath $compose -PathType Leaf)) { throw 'Preview Compose file is missing.' }
if ($DropTestData) {
  docker compose -p ultra-preview -f $compose down --volumes
  if ($LASTEXITCODE -ne 0) { throw 'Preview reset failed.' }
  Write-Host 'Only ultra-preview containers and their disposable database volume were removed.'
} else {
  docker compose -p ultra-preview -f $compose down
  if ($LASTEXITCODE -ne 0) { throw 'Preview stop failed.' }
  Write-Host 'Preview stopped. Test database retained. Use -DropTestData to erase only preview data.'
}
& (Join-Path $PSScriptRoot 'Start-Preview.ps1')