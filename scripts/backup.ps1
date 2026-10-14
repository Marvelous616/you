param (
    [string]$DbPath = "./data/life-logger.sqlite",
    [string]$BackupDir = "./backups"
)

if (-not (Test-Path $DbPath)) {
    Write-Error "Database file not found at $DbPath"
    exit 1
}

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $BackupDir "life-logger-$Timestamp.sqlite"

Write-Host "Creating online SQLite backup..."
Write-Host "Source: $DbPath"
Write-Host "Target: $BackupFile"

# Use SQLite online backup API via sqlite3 command or node script
$NodeBackupScript = @"
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');

const src = '$($DbPath.Replace('\', '/'))';
const dst = '$($BackupFile.Replace('\', '/'))';

// Ensure WAL checkpoint
const db = new DatabaseSync(src);
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();

fs.copyFileSync(src, dst);
console.log('Online checkpoint & backup successful.');
"@

node -e $NodeBackupScript

if (Test-Path $BackupFile) {
    $Size = (Get-Item $BackupFile).Length
    Write-Host "Backup completed successfully ($Size bytes)." -ForegroundColor Green
} else {
    Write-Error "Backup failed!"
    exit 1
}
