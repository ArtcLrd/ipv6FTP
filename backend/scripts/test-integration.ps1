# Offline safety foundation only. This script deliberately cannot connect or mutate.
# Dot-source to exercise the pure guards; direct execution always refuses.
Set-StrictMode -Version Latest

function Assert-TestInstanceConfig {
    param(
        [Parameter(Mandatory = $true)][string]$HostAddress,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ExpectedMarker
    )
    # Numeric loopback literals only: no DNS, sockets, URI parameters or aliases.
    if ($HostAddress -cne '127.0.0.1' -and $HostAddress -cne '::1') {
        throw 'A numeric loopback address is required.'
    }
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid port.' }
    # A deliberate cluster marker is separate from both the DB name and endpoint.
    if ($ExpectedMarker -cnotmatch '^ipv6ftp-test-only:[0-9a-f]{32}$') {
        throw 'A test-only cluster marker is required.'
    }
}

function Assert-TestInstanceIdentity {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedMarker,
        [Parameter(Mandatory = $true)][string]$ObservedMarker
    )
    if ($ExpectedMarker -cnotmatch '^ipv6ftp-test-only:[0-9a-f]{32}$' -or
        $ObservedMarker -cne $ExpectedMarker) {
        throw 'Test cluster identity mismatch.'
    }
}

function New-TestDatabaseName {
    $bytes = New-Object byte[] 16
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return 'ipv6ftp_it_' + ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
}

function New-MigratorEnvironment {
    param([Parameter(Mandatory = $true)][string]$MigratorDatabaseUrl)
    if ([string]::IsNullOrWhiteSpace($MigratorDatabaseUrl)) { throw 'Missing migrator target.' }
    # This is an environment specification, not a process invocation. Any future
    # launcher must clear the child's inherited environment before applying it.
    return @{ MIGRATOR_DATABASE_URL = $MigratorDatabaseUrl; GOTOOLCHAIN = 'local' }
}

# Reserve a directory with create-only semantics. Never adopt an existing path.
function New-PrivateRunDirectory {
    param([Parameter(Mandatory = $true)][string]$Parent)
    $name = New-TestDatabaseName
    $path = Join-Path $Parent $name
    $item = New-Item -ItemType Directory -Path $path -ErrorAction Stop
    return $item.FullName
}

# Construct a real, isolated child environment rather than inheriting PG*, app
# DSNs or Go overrides. Required Windows process variables are copied narrowly.
function Set-IsolatedChildEnvironment {
    param(
        [Parameter(Mandatory = $true)]$StartInfo,
        [Parameter(Mandatory = $true)][string]$MigratorDatabaseUrl
    )
    $StartInfo.EnvironmentVariables.Clear()
    foreach ($key in @('SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA')) {
        $value = [Environment]::GetEnvironmentVariable($key, 'Process')
        if (-not [string]::IsNullOrEmpty($value)) { $StartInfo.EnvironmentVariables[$key] = $value }
    }
    $StartInfo.EnvironmentVariables['MIGRATOR_DATABASE_URL'] = $MigratorDatabaseUrl
    $StartInfo.EnvironmentVariables['GOTOOLCHAIN'] = 'local'
}

# Cleanup is restricted to the original process object and its recorded start
# time. If identity cannot be confirmed, leave both process and files intact.
function Stop-OwnedTestProcess {
    param([Parameter(Mandatory = $true)]$Process, [Parameter(Mandatory = $true)][datetime]$StartedAt)
    try {
        $Process.Refresh()
        if ($Process.HasExited) { return $true }
        if ($Process.StartTime -ne $StartedAt) { return $false }
        $Process.Kill()
        return $Process.WaitForExit(5000)
    } catch { return $false }
}

# Offline lifecycle model. Adapters are intentionally not supplied by direct
# execution: a production adapter must independently prove listener ownership.
function Invoke-TestLifecycleModel {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][hashtable]$Operations)
    $required = @('CreateDirectory', 'Initialize', 'Start', 'VerifyOwner', 'CreateDatabase',
        'BootstrapRoles', 'MarkMaintenance', 'Migrate', 'MarkTest', 'RunTests', 'Stop', 'RemoveDirectory')
    foreach ($name in $required) {
        if (-not $Operations.ContainsKey($name) -or $Operations[$name] -isnot [scriptblock]) {
            throw "Missing lifecycle operation: $name"
        }
    }
    $directory = $null
    $process = $null
    $startAttempted = $false
    try {
        $directory = & $Operations.CreateDirectory
        if ($null -eq $directory) { throw 'No owned directory returned.' }
        & $Operations.Initialize $directory | Out-Null
        # A failed launch may still have spawned a process; retain the directory.
        $startAttempted = $true
        $process = & $Operations.Start $directory
        if ($null -eq $process) { throw 'No owned process returned.' }
        foreach ($stage in @('CreateDatabase', 'BootstrapRoles', 'MarkMaintenance', 'Migrate', 'MarkTest', 'RunTests')) {
            if ((& $Operations.VerifyOwner $process) -cne $true) { throw "Ownership verification failed before $stage." }
            & $Operations[$stage] $process | Out-Null
        }
    } finally {
        $safeToRemove = -not $startAttempted
        if ($null -ne $process) {
            try { $safeToRemove = ((& $Operations.Stop $process) -ceq $true) } catch { $safeToRemove = $false }
        }
        if ($null -ne $directory -and $safeToRemove) { & $Operations.RemoveDirectory $directory | Out-Null }
        elseif ($null -ne $directory) { Write-Warning 'Retaining run directory: process termination was not confirmed.' }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    throw 'Integration execution disabled: independent cluster identity and owned-database lifecycle are not implemented.'
}
