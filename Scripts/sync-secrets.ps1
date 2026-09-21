param(
    [string]$SecretsFile = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SecretsFile)) {
    $SecretsFile = Join-Path $RepoRoot ".env.secrets"
}

if (-not (Test-Path -Path $SecretsFile)) {
    throw "Secrets file not found: $SecretsFile"
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "gh was not found. Install GitHub CLI first and run gh auth login."
}

gh auth status | Out-Null

$syncedCount = 0

foreach ($rawLine in Get-Content -Path $SecretsFile -Encoding UTF8) {
    $line = $rawLine.Trim()

    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) {
        continue
    }

    $parts = $line -split '=', 2
    if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($parts[0])) {
        throw "Invalid secrets line: $rawLine"
    }

    $name = $parts[0].Trim()
    $value = $parts[1]

    Write-Host "[INFO] Syncing secret: $name"
    gh secret set $name --body $value | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to sync secret: $name"
    }

    $syncedCount++
}

Write-Host "[SUCCESS] Synced $syncedCount GitHub Actions secrets."
