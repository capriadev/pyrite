# backup.ps1 - generic backup engine.
# Reads ./backup.config.ps1 (copy from backup.config.example.ps1 first).
# Usage: npm run back

$ErrorActionPreference = "Stop"
$ScriptRoot = $PSScriptRoot
$ConfigFile = Join-Path $ScriptRoot "backup.config.ps1"

function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }
function Step($msg) { Say ">> $msg" "Cyan" }
function Ok($msg) { Say "   OK: $msg" "Green" }
function Skip($msg) { Say "   SKIP: $msg" "DarkYellow" }
function Fail($msg) { Say "   FAIL: $msg" "Red" }

if (-not (Test-Path $ConfigFile)) {
    Fail "backup.config.ps1 not found. Copy backup.config.example.ps1 to backup.config.ps1 and edit it."
    exit 1
}
. $ConfigFile

function Resolve-AutoPath($value, $projectName) {
    return $value -replace '\{auto\}', $projectName
}

$Config.ExternalPath  = Resolve-AutoPath $Config.ExternalPath  $Config.ProjectName
$Config.DbContainer   = Resolve-AutoPath $Config.DbContainer   $Config.ProjectName
$Config.DbVolume      = Resolve-AutoPath $Config.DbVolume      $Config.ProjectName
foreach ($remote in $Config.CloudRemotes) {
    $remote.Path = Resolve-AutoPath $remote.Path $Config.ProjectName
}

$ProjectRoot = $ScriptRoot
$dateStr = Get-Date -Format "dd-MM-yyyy"

function Get-NextBackupNumber($root, $prefix) {
    if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
    $existing = Get-ChildItem -Path $root -Directory -Filter "$prefix-*-b*" -ErrorAction SilentlyContinue
    if (-not $existing) { return 1 }
    $nums = @()
    foreach ($item in $existing) {
        if ($item.Name -match "-b(\d+)$") { $nums += [int]$matches[1] }
    }
    if ($nums.Count -eq 0) { return 1 }
    return ($nums | Measure-Object -Maximum).Maximum + 1
}

$stagingRoot = Join-Path $ProjectRoot ($Config.LocalPath)
$systemRoot = Join-Path $stagingRoot $Config.LocalSystemSubfolder
$dbRoot     = Join-Path $stagingRoot $Config.LocalDbSubfolder
$n = Get-NextBackupNumber -root $systemRoot -prefix $Config.ProjectName
$backupName = "$($Config.ProjectName)-$dateStr-b$n"

Say ""
Say "==================================================" "Cyan"
Say " BACKUP: $backupName" "Cyan"
Say "==================================================" "Cyan"

# ---- 1) Copy project files into staging (always happens locally first, even if LocalEnabled=false, as a working copy) ----
$systemTarget = Join-Path $systemRoot $backupName
$dbTarget     = $dbRoot

Step "Copying project files"
if ($Config.LocalSystemEnabled) {
    New-Item -ItemType Directory -Path $systemTarget -Force | Out-Null
} else {
    Skip "System files backup disabled in config"
}

$xdArgs = $Config.ExcludeDirs
$xfArgs = $Config.ExcludeFiles

if ($Config.OnlyPaths.Count -gt 0) {
    foreach ($p in $Config.OnlyPaths) {
        $src = Join-Path $ProjectRoot $p
        $dst = Join-Path $systemTarget $p
        if (Test-Path $src) {
            robocopy $src $dst /E /XD $xdArgs /XF $xfArgs /NFL /NDL /NJH /NJS /NP | Out-Null
        }
    }
} else {
    robocopy $ProjectRoot $systemTarget /E /XD $xdArgs /XF $xfArgs /NFL /NDL /NJH /NJS /NP | Out-Null
}
Ok "Project files staged at $systemTarget"

# ---- 2) Database ----
if ($Config.DbEnabled) {
    Step "Database ($($Config.DbMode) mode, container: $($Config.DbContainer))"
    $containerRunning = (docker ps --filter "name=$($Config.DbContainer)" --format "{{.Names}}" 2>$null) -eq $Config.DbContainer

    if (-not $containerRunning) {
        Skip "Container '$($Config.DbContainer)' not running - DB backup skipped"
    }
    elseif ($Config.DbMode -eq "dump") {
        if (-not (Test-Path $dbTarget)) { New-Item -ItemType Directory -Path $dbTarget -Force | Out-Null }
        $dumpFile = Join-Path $dbTarget "db-$backupName.sql"
        switch ($Config.DbEngine) {
            "postgres" { docker exec $Config.DbContainer pg_dump -U $Config.DbUser -d $Config.DbName > $dumpFile }
            "mysql"    { docker exec $Config.DbContainer mysqldump -u $Config.DbUser -p$Config.DbPassword $Config.DbName > $dumpFile }
            "mongo"    { docker exec $Config.DbContainer mongodump --archive=/tmp/dump.archive; docker cp "$($Config.DbContainer):/tmp/dump.archive" $dumpFile }
            default    { Fail "Unknown DbEngine '$($Config.DbEngine)' - use DbMode=volume instead for unsupported engines" }
        }
        if ($LASTEXITCODE -eq 0) { Ok "DB dump: $dumpFile" } else { Fail "dump failed" }
    }
    elseif ($Config.DbMode -eq "volume") {
        if (-not (Test-Path $dbTarget)) { New-Item -ItemType Directory -Path $dbTarget -Force | Out-Null }
        $tarFile = "db-$backupName.tar.gz"
        $tarPathInContainer = "/backup-out/$tarFile"
        docker run --rm `
            -v "$($Config.DbVolume):/data:ro" `
            -v "${dbTarget}:/backup-out" `
            alpine sh -c "tar czf $tarPathInContainer -C /data ." | Out-Null
        if ($LASTEXITCODE -eq 0) { Ok "DB volume archive: $(Join-Path $dbTarget $tarFile)" } else { Fail "volume tar export failed" }
    }
} else {
    Skip "Database backup disabled in config"
}

# ---- 3) Distribute to targets ----
if ($Config.LocalEnabled) {
    Ok "Local target already in place: $stagingRoot"
} else {
    Skip "Local target disabled"
}

if ($Config.ExternalEnabled) {
    Step "External drive: $($Config.ExternalPath)"
    $extParent = Split-Path $Config.ExternalPath -Parent
    if (-not (Test-Path $extParent)) {
        Skip "Path not reachable (drive disconnected?) - $($Config.ExternalPath)"
    } else {
        $extSystemTarget = Join-Path $Config.ExternalPath (Join-Path $Config.LocalSystemSubfolder $backupName)
        robocopy $systemTarget $extSystemTarget /E /NFL /NDL /NJH /NJS /NP | Out-Null

        $extDbTarget = Join-Path $Config.ExternalPath $Config.LocalDbSubfolder
        if (-not (Test-Path $extDbTarget)) { New-Item -ItemType Directory -Path $extDbTarget -Force | Out-Null }
        if (Test-Path $dbTarget) {
            Get-ChildItem -Path $dbTarget -Filter "*$backupName*" | Copy-Item -Destination $extDbTarget -Force
        }

        Ok "Copied to $($Config.ExternalPath) (system/$backupName + docker/)"
    }
} else {
    Skip "External drive target disabled"
}

if ($Config.CloudEnabled) {
    $rclonePath = Get-Command rclone -ErrorAction SilentlyContinue
    if (-not $rclonePath) {
        Skip "rclone not installed - all cloud/remote targets skipped (https://rclone.org)"
    } else {
        foreach ($remote in $Config.CloudRemotes) {
            $resolvedPath = Resolve-AutoPath $remote.Path $Config.ProjectName
            Step "Remote '$($remote.Name)': $resolvedPath"
            rclone copy $systemTarget "$resolvedPath/$($Config.LocalSystemSubfolder)/$backupName" --progress
            if (Test-Path $dbTarget) {
                Get-ChildItem -Path $dbTarget -Filter "*$backupName*" | ForEach-Object {
                    rclone copyto $_.FullName "$resolvedPath/$($Config.LocalDbSubfolder)/$($_.Name)" --progress
                }
            }
            if ($LASTEXITCODE -eq 0) { Ok "Uploaded to $($remote.Name)" } else { Fail "Upload to $($remote.Name) failed" }
        }
    }
} else {
    Skip "Cloud/remote targets disabled"
}

if (-not $Config.LocalEnabled) {
    if (Test-Path $systemTarget) { Remove-Item -Path $systemTarget -Recurse -Force }
    if (Test-Path $dbTarget) {
        Get-ChildItem -Path $dbTarget -Filter "*$backupName*" | Remove-Item -Force
    }
    Say "   (staging copy removed - LocalEnabled was false)" "DarkGray"
}

Say ""
Say "==================================================" "Cyan"
Say " DONE: $backupName" "Cyan"
Say "==================================================" "Cyan"