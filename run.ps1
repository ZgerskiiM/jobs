$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (-not (Test-Path "$ProjectDir\config.json")) {
    Copy-Item "$ProjectDir\config.russia.json" "$ProjectDir\config.json"
    Write-Host "Создан config.json. Укажите настоящую почту в hh_user_agent и запустите скрипт снова."
    exit 0
}

Push-Location $ProjectDir
try {
    & $Python job_tracker.py sync --config config.json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $Python job_tracker.py export --output data/jobs.csv
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}

