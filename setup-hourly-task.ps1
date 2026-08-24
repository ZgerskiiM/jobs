$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$ConfigDir = Join-Path $ProjectDir "config"
$CredentialPath = Join-Path $ConfigDir "telegram-bot.credential.xml"
$SettingsPath = Join-Path $ConfigDir "telegram-settings.json"
$RunnerPath = Join-Path $ProjectDir "run-hourly.ps1"
$TaskName = "JobTrackerHourly"

New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

$SecureToken = Read-Host "Токен Telegram-бота от BotFather" -AsSecureString
$Credential = [PSCredential]::new("telegram-bot", $SecureToken)
$PlainToken = $Credential.GetNetworkCredential().Password
Write-Host "Теперь откройте своего бота в Telegram и отправьте ему /start."
Read-Host "После отправки нажмите Enter"
try {
    $Updates = Invoke-RestMethod `
        -Uri "https://api.telegram.org/bot$PlainToken/getUpdates" `
        -Method Get `
        -TimeoutSec 30
}
catch {
    throw "Не удалось обратиться к Telegram. Проверьте токен и подключение к интернету."
}
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
$TechnologyInput = Read-Host "Технологии для уведомлений через запятую [Java]; * — все вакансии"
if ([string]::IsNullOrWhiteSpace($TechnologyInput)) { $TechnologyInput = "Java" }
$Technologies = if ($TechnologyInput.Trim() -eq "*") {
    @()
} else {
    @($TechnologyInput.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$Credential | Export-Clixml -LiteralPath $CredentialPath
@{
    chat_id = $ChatId
    filter = @{
        technologies = $Technologies
        keywords = @()
        companies = @()
        locations = @()
    }
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $SettingsPath -Encoding UTF8

$env:TELEGRAM_BOT_TOKEN = $PlainToken
$env:TELEGRAM_CHAT_ID = $ChatId
try {
    Push-Location $ProjectDir
    & $Python job_tracker.py --db data/jobs.sqlite3 telegram-test
    if ($LASTEXITCODE -ne 0) { throw "Тест Telegram завершился ошибкой." }
    & $Python job_tracker.py --db data/jobs.sqlite3 telegram-init
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
$Trigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Hours 1)
$Settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Ежечасно обновляет вакансии и отправляет новые в Telegram" `
    -Force | Out-Null

Write-Host "Готово. Задача $TaskName будет запускаться раз в час."
Write-Host "Лог: $ProjectDir\logs\hourly.log"

