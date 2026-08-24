$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

Push-Location $ProjectDir
try {
    & $Python local_server.py --open
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}

