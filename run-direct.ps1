$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$CredentialPath = Join-Path $ProjectDir "config\telegram-bot.credential.xml"
$SettingsPath = Join-Path $ProjectDir "config\telegram-settings.json"

Push-Location $ProjectDir
try {
    & $Python job_tracker.py --db data/jobs.sqlite3 sync --config config.direct.json
    $SyncExit = $LASTEXITCODE

    $NotifyExit = 0
    if ((Test-Path -LiteralPath $CredentialPath) -and (Test-Path -LiteralPath $SettingsPath)) {
        $Credential = Import-Clixml -LiteralPath $CredentialPath
        $Settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
        $env:TELEGRAM_BOT_TOKEN = $Credential.GetNetworkCredential().Password
        $env:TELEGRAM_CHAT_ID = [string]$Settings.chat_id
        & $Python job_tracker.py --db data/jobs.sqlite3 telegram-notify --settings $SettingsPath
        $NotifyExit = $LASTEXITCODE
    } else {
        Write-Host "Telegram не настроен: обновление выполнено без уведомлений."
    }

    & $Python job_tracker.py --db data/jobs.sqlite3 export --output data/jobs.csv
    $ExportExit = $LASTEXITCODE
    & $Python job_tracker.py --db data/jobs.sqlite3 site-data --output site/vacancies.js
    $SiteExit = $LASTEXITCODE
    if ($SyncExit -ne 0 -or $NotifyExit -ne 0 -or $ExportExit -ne 0 -or $SiteExit -ne 0) { exit 1 }
    exit 0
}
finally {
    Remove-Item Env:TELEGRAM_BOT_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:TELEGRAM_CHAT_ID -ErrorAction SilentlyContinue
    Pop-Location
}
