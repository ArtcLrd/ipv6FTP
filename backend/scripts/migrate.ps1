param(
    [ValidateSet("status", "up")]
    [string]$Command = "status"
)

$ErrorActionPreference = "Stop"
$BackendRoot = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $BackendRoot
$GoCache = Join-Path $WorkspaceRoot ".go-cache"
$GoTmp = Join-Path $WorkspaceRoot ".go-tmp"

New-Item -ItemType Directory -Force -Path $GoCache | Out-Null
New-Item -ItemType Directory -Force -Path $GoTmp | Out-Null

$env:GOCACHE = $GoCache
$env:GOTMPDIR = $GoTmp

Push-Location $BackendRoot
try {
    go run ./cmd/migrate $Command
} finally {
    Pop-Location
}
