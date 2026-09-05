$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Security
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$ConfigDir = Join-Path $ProjectDir "config"
$CredentialPath = Join-Path $ConfigDir "telegram-bot.token"
$FilterPath = Join-Path $ConfigDir "telegram-filter.json"
$SettingsPath = Join-Path $ConfigDir "telegram-settings.json"

$PlainToken = [string]$env:TELEGRAM_BOT_TOKEN
$TokenWasSupplied = [bool]$PlainToken
if ($PlainToken) {
    Remove-Item Env:TELEGRAM_BOT_TOKEN -ErrorAction SilentlyContinue
} else {
    $SecureToken = Read-Host "Токен Telegram-бота от BotFather" -AsSecureString
    $Credential = [PSCredential]::new("telegram-bot", $SecureToken)
    $PlainToken = $Credential.GetNetworkCredential().Password
}
Write-Host "Откройте бота в Telegram и отправьте ему /start."
if (-not $TokenWasSupplied) {
    Read-Host "После этого нажмите Enter"
}

$env:TELEGRAM_BOT_TOKEN = $PlainToken
$env:HTTPS_PROXY = "http://127.0.0.1:10809"
$env:HTTP_PROXY = "http://127.0.0.1:10809"
$UpdatesJson = & $Python (Join-Path $ProjectDir "telegram_setup_helper.py")
if ($LASTEXITCODE -ne 0) { throw "Не удалось получить сообщения Telegram." }
$Updates = $UpdatesJson | ConvertFrom-Json
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

$PlainToken | Set-Content -LiteralPath $CredentialPath -Encoding ASCII -NoNewline
icacls.exe $CredentialPath /inheritance:r /grant:r "$env:USERNAME`:(R,W)" | Out-Null
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
    Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
    Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
}

Write-Host "Готово. Отправлена первая Java-подборка из 10 вакансий."
Write-Host "Теперь кнопка обновления будет присылать только новые совпадения."
