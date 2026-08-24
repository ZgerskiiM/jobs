$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$ConfigDir = Join-Path $ProjectDir "config"
$CredentialPath = Join-Path $ConfigDir "telegram-bot.credential.xml"
$FilterPath = Join-Path $ConfigDir "telegram-filter.json"
$SettingsPath = Join-Path $ConfigDir "telegram-settings.json"

$SecureToken = Read-Host "Токен Telegram-бота от BotFather" -AsSecureString
$Credential = [PSCredential]::new("telegram-bot", $SecureToken)
$PlainToken = $Credential.GetNetworkCredential().Password
Write-Host "Откройте бота в Telegram и отправьте ему /start."
Read-Host "После этого нажмите Enter"

$Updates = Invoke-RestMethod `
    -Uri "https://api.telegram.org/bot$PlainToken/getUpdates" `
    -Method Get `
    -TimeoutSec 30
$Chats = @($Updates.result | ForEach-Object {
    if ($_.message.chat) { $_.message.chat }
    elseif ($_.channel_post.chat) { $_.channel_post.chat }
})
if ($Chats.Count -eq 0) {
    throw "Telegram не вернул чат. Отправьте боту /start и повторите настройку."
}
$Chat = $Chats[-1]
$ChatId = [string]$Chat.id
$Filter = Get-Content -LiteralPath $FilterPath -Raw | ConvertFrom-Json

$Credential | Export-Clixml -LiteralPath $CredentialPath
@{ chat_id = $ChatId; filter = $Filter } |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $SettingsPath -Encoding UTF8

$env:TELEGRAM_BOT_TOKEN = $PlainToken
$env:TELEGRAM_CHAT_ID = $ChatId
try {
    Push-Location $ProjectDir
    & $Python job_tracker.py --db data/jobs.sqlite3 telegram-test
    if ($LASTEXITCODE -ne 0) { throw "Тест Telegram завершился ошибкой." }
    & $Python job_tracker.py --db data/jobs.sqlite3 telegram-init --force
    if ($LASTEXITCODE -ne 0) { throw "Не удалось инициализировать очередь." }
    & $Python job_tracker.py --db data/jobs.sqlite3 telegram-digest --settings $SettingsPath --limit 10
    if ($LASTEXITCODE -ne 0) { throw "Не удалось отправить первую подборку." }
}
finally {
    Pop-Location
    Remove-Item Env:TELEGRAM_BOT_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:TELEGRAM_CHAT_ID -ErrorAction SilentlyContinue
}

Write-Host "Готово. Отправлена первая Java-подборка из 10 вакансий."
Write-Host "Теперь кнопка обновления будет присылать только новые совпадения."
