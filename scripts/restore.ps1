param (
    [string]$BackupFile,
    [string]$SandboxDir = "./sandbox_restore"
)

if (-not $BackupFile) {
    # Find latest backup in ./backups
    $Latest = Get-ChildItem -Path "./backups" -Filter "*.sqlite" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $Latest) {
        Write-Error "No backup file found in ./backups"
        exit 1
    }
    $BackupFile = $Latest.FullName
}

Write-Host "Starting disaster recovery verification..."
Write-Host "Source backup: $BackupFile"

if (Test-Path $SandboxDir) {
    Remove-Item -Recurse -Force $SandboxDir
}
New-Item -ItemType Directory -Path $SandboxDir -Force | Out-Null

$RestoredDbPath = Join-Path $SandboxDir "restored.sqlite"
Copy-Item $BackupFile $RestoredDbPath

Write-Host "Verifying database integrity and querying records..."
node ./scripts/verify-restore.mjs $RestoredDbPath

if ($LASTEXITCODE -eq 0) {
    Write-Host "Restore verification test passed successfully!" -ForegroundColor Green
} else {
    Write-Error "Restore verification failed!"
    exit 1
}
