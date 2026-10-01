$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$compose = Join-Path $repository 'infra/preview/compose.yaml'
if (-not (Test-Path -LiteralPath $compose -PathType Leaf)) { throw 'Preview Compose file is missing.' }
docker compose -p ultra-preview -f $compose down
if ($LASTEXITCODE -ne 0) { throw 'Preview did not stop cleanly.' }
Write-Host 'Preview containers stopped; disposable preview database retained.'
