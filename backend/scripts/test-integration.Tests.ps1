# Standalone offline tests; no Pester, database, external processes or network.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'test-integration.ps1')
function Expect-Failure([scriptblock]$Action) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    if (-not $failed) { throw 'Expected rejection.' }
}
$marker = 'ipv6ftp-test-only:0123456789abcdef0123456789abcdef'
Assert-TestInstanceConfig -HostAddress '127.0.0.1' -Port 5433 -ExpectedMarker $marker
Assert-TestInstanceConfig -HostAddress '::1' -Port 5433 -ExpectedMarker $marker
Expect-Failure { Assert-TestInstanceConfig -HostAddress 'localhost' -Port 5433 -ExpectedMarker $marker }
Expect-Failure { Assert-TestInstanceConfig -HostAddress '127.0.0.2' -Port 5433 -ExpectedMarker $marker }
Expect-Failure { Assert-TestInstanceConfig -HostAddress '127.0.0.1' -Port 0 -ExpectedMarker $marker }
Expect-Failure { Assert-TestInstanceConfig -HostAddress '127.0.0.1' -Port 5433 -ExpectedMarker 'test_db' }
Assert-TestInstanceIdentity -ExpectedMarker $marker -ObservedMarker $marker
Expect-Failure { Assert-TestInstanceIdentity -ExpectedMarker $marker -ObservedMarker 'ipv6ftp-test-only:ffffffffffffffffffffffffffffffff' }
$name1 = New-TestDatabaseName
$name2 = New-TestDatabaseName
if ($name1 -cnotmatch '^ipv6ftp_it_[0-9a-f]{32}$' -or $name1 -ceq $name2) { throw 'Invalid generated name.' }
$previousUrl = [Environment]::GetEnvironmentVariable('IPV6FTP_DATABASE_URL', 'Process')
$env:IPV6FTP_DATABASE_URL = 'must-not-be-inherited'
try {
    $child = New-MigratorEnvironment -MigratorDatabaseUrl 'test-only-placeholder'
    if ($child.Count -ne 2 -or $child.ContainsKey('IPV6FTP_DATABASE_URL') -or
        $child.MIGRATOR_DATABASE_URL -cne 'test-only-placeholder') { throw 'Unsafe environment specification.' }
} finally { [Environment]::SetEnvironmentVariable('IPV6FTP_DATABASE_URL', $previousUrl, 'Process') }
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.EnvironmentVariables['PGHOST'] = 'unsafe'
$info.EnvironmentVariables['DATABASE_URL'] = 'unsafe'
Set-IsolatedChildEnvironment -StartInfo $info -MigratorDatabaseUrl 'explicit-target'
if ($info.EnvironmentVariables.ContainsKey('PGHOST') -or $info.EnvironmentVariables.ContainsKey('DATABASE_URL') -or
    $info.EnvironmentVariables['MIGRATOR_DATABASE_URL'] -cne 'explicit-target') { throw 'Environment was not isolated.' }

# Fake process objects exercise cleanup without starting any child process.
function New-FakeProcess([datetime]$StartTime, [bool]$Exited, [bool]$WaitResult) {
    $p = [pscustomobject]@{ StartTime = $StartTime; HasExited = $Exited; Killed = $false; WaitResult = $WaitResult }
    $p | Add-Member ScriptMethod Refresh { }
    $p | Add-Member ScriptMethod Kill { $this.Killed = $true }
    $p | Add-Member ScriptMethod WaitForExit { param($timeout) return $this.WaitResult }
    return $p
}
$started = [datetime]::UtcNow
$p = New-FakeProcess $started $false $true
if (-not (Stop-OwnedTestProcess $p $started) -or -not $p.Killed) { throw 'Owned process not stopped.' }
$p = New-FakeProcess $started $false $true
if ((Stop-OwnedTestProcess $p $started.AddSeconds(1)) -or $p.Killed) { throw 'Uncertain process was touched.' }
$p = New-FakeProcess $started $false $false
if (Stop-OwnedTestProcess $p $started) { throw 'Timeout must retain resources.' }
$p = New-FakeProcess $started $true $true
if (-not (Stop-OwnedTestProcess $p $started) -or $p.Killed) { throw 'Exited process handling failed.' }
# Model lifecycle ordering and fail-closed cleanup without invoking executables.
$script:events = [System.Collections.Generic.List[string]]::new()
$ops = @{
    CreateDirectory = { $script:events.Add('directory'); return 'owned' }
    Initialize = { param($d) $script:events.Add('init') }
    Start = { param($d) $script:events.Add('start'); return 'process' }
    VerifyOwner = { param($p) $script:events.Add('verify'); return $true }
    CreateDatabase = { $script:events.Add('create') }
    BootstrapRoles = { $script:events.Add('roles') }
    MarkMaintenance = { $script:events.Add('maintenance') }
    Migrate = { $script:events.Add('migrate') }
    MarkTest = { $script:events.Add('marker') }
    RunTests = { $script:events.Add('tests') }
    Stop = { $script:events.Add('stop'); return $true }
    RemoveDirectory = { $script:events.Add('remove') }
}
Invoke-TestLifecycleModel $ops
$expected = 'directory,init,start,verify,create,verify,roles,verify,maintenance,verify,migrate,verify,marker,verify,tests,stop,remove'
if (($script:events -join ',') -cne $expected) { throw 'Unexpected lifecycle ordering.' }
$script:events.Clear()
$bad = $ops.Clone()
$bad.VerifyOwner = { $script:events.Add('verify'); return $false }
Expect-Failure { Invoke-TestLifecycleModel $bad }
if (($script:events -join ',') -cne 'directory,init,start,verify,stop,remove') { throw 'Identity failure did not stop safely.' }
$script:events.Clear()
$bad = $ops.Clone()
$bad.Migrate = { throw 'migration failed' }
$bad.Stop = { $script:events.Add('stop'); return $false }
Expect-Failure { Invoke-TestLifecycleModel $bad -WarningAction SilentlyContinue }
if ($script:events.Contains('marker') -or $script:events.Contains('remove') -or -not $script:events.Contains('stop')) { throw 'Failure cleanup was unsafe.' }
$script:events.Clear()
$bad = $ops.Clone()
$bad.Start = { throw 'uncertain launch' }
Expect-Failure { Invoke-TestLifecycleModel $bad -WarningAction SilentlyContinue }
if ($script:events.Contains('remove')) { throw 'Uncertain launch must retain directory.' }
Expect-Failure { & (Join-Path $PSScriptRoot 'test-integration.ps1') }
Write-Output 'Offline guard tests passed.'
