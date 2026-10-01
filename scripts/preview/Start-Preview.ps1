$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$compose = Join-Path $repository 'infra/preview/compose.yaml'
if (-not (Test-Path -LiteralPath $compose -PathType Leaf)) { throw 'Preview Compose file is missing.' }
docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running. Start it, wait for the engine, then retry.' }
docker compose -p ultra-preview -f $compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Preview configuration is invalid.' }
docker compose -p ultra-preview -f $compose up --build --detach --wait
if ($LASTEXITCODE -ne 0) { throw 'Preview failed to start. See docker compose logs for details.' }
node (Join-Path $repository 'scripts/preview/smoke.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Preview started, but smoke checks failed.' }
Write-Host 'Companion: http://localhost:3000/ | Project Hub: http://localhost:5055/ | API: http://localhost:5000/api/healthz'
