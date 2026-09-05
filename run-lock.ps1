function Enter-JobTrackerUpdateLock {
    $mutex = [System.Threading.Mutex]::new($false, "Local\JobTrackerVacancyUpdate")
    try {
        if ($mutex.WaitOne(0)) {
            return $mutex
        }
    }
    catch [System.Threading.AbandonedMutexException] {
        return $mutex
    }
    $mutex.Dispose()
    return $null
}

function Exit-JobTrackerUpdateLock {
    param([System.Threading.Mutex]$Mutex)
    if ($null -eq $Mutex) { return }
    try {
        $Mutex.ReleaseMutex()
    }
    finally {
        $Mutex.Dispose()
    }
}
