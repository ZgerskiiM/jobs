$ErrorActionPreference = "Continue"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$CredentialPath = Join-Path $ProjectDir "config\telegram-bot.credential.xml"
$SettingsPath = Join-Path $ProjectDir "config\telegram-settings.json"
$LogDir = Join-Path $ProjectDir "logs"
$LogPath = Join-Path $LogDir "nightly.log"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

if (-not (Test-Path -LiteralPath $CredentialPath) -or -not (Test-Path -LiteralPath $SettingsPath)) {
    "$(Get-Date -Format o) Telegram не настроен. Запустите setup-nightly-task.ps1." |
        Tee-Object -FilePath $LogPath -Append
    exit 2
}

$Credential = Import-Clixml -LiteralPath $CredentialPath
$Settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
$env:TELEGRAM_BOT_TOKEN = $Credential.GetNetworkCredential().Password
$env:TELEGRAM_CHAT_ID = [string]$Settings.chat_id

Push-Location $ProjectDir
try {
    "`n$(Get-Date -Format o) Начало ночного обновления" | Tee-Object -FilePath $LogPath -Append

    & $Python job_tracker.py --db data/jobs.sqlite3 sync --config config.direct.json 2>&1 |
        Tee-Object -FilePath $LogPath -Append
    $SyncExit = $LASTEXITCODE

    & $Python job_tracker.py --db data/jobs.sqlite3 telegram-notify --settings $SettingsPath 2>&1 |
        Tee-Object -FilePath $LogPath -Append
    $NotifyExit = $LASTEXITCODE

    & $Python job_tracker.py --db data/jobs.sqlite3 export --output data/jobs.csv 2>&1 |
        Tee-Object -FilePath $LogPath -Append
    $ExportExit = $LASTEXITCODE

    & $Python job_tracker.py --db data/jobs.sqlite3 site-data --output site/vacancies.js 2>&1 |
        Tee-Object -FilePath $LogPath -Append
    $SiteExit = $LASTEXITCODE

    "$(Get-Date -Format o) Завершено: sync=$SyncExit notify=$NotifyExit export=$ExportExit site=$SiteExit" |
        Tee-Object -FilePath $LogPath -Append

    if ($NotifyExit -ne 0 -or $ExportExit -ne 0 -or $SiteExit -ne 0) { exit 1 }
    exit $SyncExit
}
finally {
    Remove-Item Env:TELEGRAM_BOT_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:TELEGRAM_CHAT_ID -ErrorAction SilentlyContinue
    Pop-Location
}

