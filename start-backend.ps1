$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if (-not (Test-Path $Python)) { $Python = (Get-Command py -ErrorAction Stop).Source }
$EnvFile = Join-Path $ProjectDir "backend\.env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2].Trim().Trim('"') }
    }
}
# The dev server runs outside Docker: keep Docker's `db` hostname out of the
# local process and use the bundled SQLite/HTTP defaults.
$env:DATABASE_URL = ""
$env:USE_REDIS_SESSIONS = "0"
$env:DJANGO_DEBUG = "1"
$env:LOCAL_AUTH_BYPASS = "1"
$PublicUrl = $env:JOBS_DEV_PUBLIC_URL
if ([string]::IsNullOrWhiteSpace($PublicUrl)) {
    $env:SESSION_COOKIE_SECURE = "0"
    $env:FRONTEND_URL = "http://127.0.0.1:8443"
}
else {
    $env:SESSION_COOKIE_SECURE = "1"
    $env:FRONTEND_URL = $PublicUrl.TrimEnd('/')
}

Push-Location (Join-Path $ProjectDir "backend")
try {
    & $Python manage.py migrate
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $Python manage.py runserver 127.0.0.1:8000
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
