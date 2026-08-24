$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$ConfigDir = Join-Path $ProjectDir "config"
$CredentialPath = Join-Path $ConfigDir "telegram-bot.credential.xml"
$FilterPath = Join-Path $ConfigDir "telegram-filter.json"
$SettingsPath = Join-Path $ConfigDir "telegram-settings.json"
$RunnerPath = Join-Path $ProjectDir "run-nightly.ps1"
$TaskName = "JobTrackerNightly"

New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

$SecureToken = Read-Host "Токен Telegram-бота от BotFather" -AsSecureString
$Credential = [PSCredential]::new("telegram-bot", $SecureToken)
$PlainToken = $Credential.GetNetworkCredential().Password
Write-Host "Откройте своего бота в Telegram и отправьте ему /start."
Read-Host "После отправки нажмите Enter"
$Updates = Invoke-RestMethod `
    -Uri "https://api.telegram.org/bot$PlainToken/getUpdates" `
    -Method Get `
    -TimeoutSec 30
$Chats = @($Updates.result | ForEach-Object {
    if ($_.message.chat) { $_.message.chat }
    elseif ($_.channel_post.chat) { $_.channel_post.chat }
})
if ($Chats.Count -eq 0) {
    throw "Telegram не вернул чат. Отправьте боту /start и запустите настройку ещё раз."
}
$Chat = $Chats[-1]
$ChatId = [string]$Chat.id
$ChatLabel = (@($Chat.first_name, $Chat.last_name, $Chat.title) | Where-Object { $_ }) -join " "
Write-Host "Найден чат: $ChatLabel ($ChatId)"

$Filter = Get-Content -LiteralPath $FilterPath -Raw | ConvertFrom-Json
$Credential | Export-Clixml -LiteralPath $CredentialPath
@{
    chat_id = $ChatId
    filter = $Filter
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $SettingsPath -Encoding UTF8

$env:TELEGRAM_BOT_TOKEN = $PlainToken
$env:TELEGRAM_CHAT_ID = $ChatId
try {
    Push-Location $ProjectDir
    & $Python job_tracker.py --db data/jobs.sqlite3 telegram-test
    if ($LASTEXITCODE -ne 0) { throw "Тест Telegram завершился ошибкой." }
    & $Python job_tracker.py --db data/jobs.sqlite3 telegram-init --force
    if ($LASTEXITCODE -ne 0) { throw "Не удалось инициализировать очередь уведомлений." }
}
finally {
    Pop-Location
    Remove-Item Env:TELEGRAM_BOT_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:TELEGRAM_CHAT_ID -ErrorAction SilentlyContinue
}

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunnerPath`""
$Trigger = New-ScheduledTaskTrigger -Daily -At "03:00"
$TaskSettings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $TaskSettings `
    -Description "Каждую ночь обновляет вакансии и отправляет новые в Telegram" `
    -Force | Out-Null

Write-Host "Готово. Задача $TaskName будет запускаться ежедневно в 03:00."
Write-Host "Фильтр: $FilterPath"
Write-Host "Лог: $ProjectDir\logs\nightly.log"

