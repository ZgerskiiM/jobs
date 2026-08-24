$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

Push-Location $ProjectDir
try {
    & $Python job_tracker.py --db data/jobs.sqlite3 sync --config config.direct.json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $Python job_tracker.py --db data/jobs.sqlite3 export --output data/jobs.csv
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $Python job_tracker.py --db data/jobs.sqlite3 site-data --output site/vacancies.js
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}

