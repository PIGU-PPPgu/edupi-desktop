#requires -Version 7.4
[CmdletBinding()]
param(
    [ValidateSet("preflight", "upgrade")][string]$Mode = "preflight",
    [switch]$CleanupDownloadOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Preflight changes no profile environment. Upgrade has a same-SID transaction,
# durable recovery journal and native /R observation; it never launches 117.
$oldHash = "73f83b411b0d461fe5bb6c632a57d02799a4efc0f930104a6b1e8ef3b6dbaa06"
$oldSource = "13de2b53d08d487a6abceb91ec1e37bd919af690"
$coreCommit = "98e4f7cd0c31dd30954574d2040bb1b948cdd954"
$driverVersion = "2.0.4"
$targetHash = "5c7dab4a4966333228771bc5b8f43953d4df191bd187dc33779034d1d6fbeb6f"
$targetSource = "a55777400dea49f1ba3d953418b6965a41942c3e"
$cohortUrl = "https://raw.githubusercontent.com/PIGU-PPPgu/edupi-desktop/c8bc4aff57f06062ff8bf4e0c56c11b6d74580bd/docs/acceptance/update-cohorts/all-116-117-20261117.json"
$script:ownedProcesses = [System.Collections.Generic.List[object]]::new()
$script:ownedDirectories = [System.Collections.Generic.List[string]]::new()
$taskRoot = $null
$destination = $null
$canaryRoot = $null
$appEnvironment = $null
$application = $null
$helperNode = $null
$tauriDriver = $null
$edgeDriver = $null
$debugPort = $null
$profileJournal = $null
$profileLease = $null
$script:upgradeInstaller = $null
$script:newApplication = $null
$script:upgradeBoundary = $null
$phase = "inputs"
$checks = [System.Collections.Generic.List[object]]::new()
$proof = @{
    schemaVersion = 1; mode = $Mode; status = "blocked"; preflightPassed = $false; actualUpgradePassed = $false
    old = @{ version = "0.3.116"; releaseId = "447334004"; assetId = "756302414"; sourceSha = $oldSource; sha256 = $oldHash }
    shell = @{ status = "not_checked" }; checks = $checks
    profileEnvironment = @{ changed = $false; upgradeInheritanceTested = $false }
    upgrade = @{ status = "not_executed"; implementation = "implemented_pending_dedicated_runner_acceptance" }
    cleanup = @{ status = "not_started"; remainingOwnedProcesses = @(); removed = @() }
}

function Assert-Condition([bool]$Condition, [string]$Code) {
    if (!$Condition) { throw $Code }
}
function Get-SafeCode($ErrorRecord) {
    $message = $ErrorRecord.Exception.Message
    if ($message -cmatch '^[a-z][a-z0-9_]{0,99}$') { return $message }
    return "phase_failed"
}
function Get-SafeDiagnostic($ErrorRecord, [string]$Stage) {
    # Deliberately omit Message, TargetObject, PositionMessage and raw stack
    # text: framework errors can embed paths, arguments or environment values.
    $chain = [System.Collections.Generic.List[object]]::new()
    $exception = $ErrorRecord.Exception
    for ($depth = 0; $null -ne $exception -and $depth -lt 6; $depth++) {
        $native = $null
        if ($exception -is [System.ComponentModel.Win32Exception]) { $native = $exception.NativeErrorCode }
        $chain.Add(@{ type = $exception.GetType().FullName; hResult = $exception.HResult; nativeErrorCode = $native })
        $exception = $exception.InnerException
    }
    $lines = @([regex]::Matches([string]$ErrorRecord.ScriptStackTrace, '(?m): line ([0-9]+)\r?$')
        | ForEach-Object { [int]$_.Groups[1].Value })
    return @{ phase = $Stage; scriptLineNumber = $ErrorRecord.InvocationInfo.ScriptLineNumber
        stackLineNumbers = $lines; exceptions = $chain.ToArray() }
}
function Set-Phase([string]$Stage) {
    $script:phase = $Stage
    Save-Evidence
}
function Get-AcceptanceOutcome([string]$Mode, [string]$Shell, [string]$Cleanup, [object[]]$Checks) {
    $upgradeNames = @("native-upgrade-gate", "public-117-target", "profile-environment-set",
        "old-ui-native-upgrade", "automatic-117-restart", "installed-117-core98-bytes", "same-object-upgrade-readback", "profile-environment-restored")
    $oldNames = @("exact-116-installer", "isolated-environment", "installed-116-core98-bytes",
        "webview2-runtime", "edge-driver", "tauri-driver", "real-webview-preflight")
    $passed = $Shell -ceq "passed" -and $Cleanup -ceq "passed"
    foreach ($name in $oldNames) {
        if (@($Checks | Where-Object { $_.name -ceq $name -and $_.status -ceq "passed" }).Count -ne 1) { $passed = $false }
    }
    $upgradePassed = $Mode -ceq "upgrade" -and $passed -and @($Checks | Where-Object { $_.status -cne "passed" }).Count -eq 0
    foreach ($name in $upgradeNames) {
        if (@($Checks | Where-Object { $_.name -ceq $name -and $_.status -ceq "passed" }).Count -ne 1) { $upgradePassed = $false }
    }
    $failed = $Cleanup -ceq "failed" -or @($Checks | Where-Object { $_.status -ceq "failed" }).Count -gt 0
    return @{ status = if ($failed) { "failed" } elseif ($upgradePassed) { "upgrade_passed" }
        elseif ($Mode -ceq "preflight" -and $passed -and @($Checks | Where-Object { $_.status -cne "passed" }).Count -eq 0) { "preflight_passed" } else { "blocked" }
        preflightPassed = $passed; actualUpgradePassed = $upgradePassed -and !$failed }
}
function Assert-NoReparseAncestor([string]$Path) {
    $cursor = [System.IO.DirectoryInfo]::new([System.IO.Path]::GetFullPath($Path))
    while ($null -ne $cursor) {
        if (Test-Path -LiteralPath $cursor.FullName) {
            Assert-Condition (($cursor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "reparse_point_refused"
        }
        $cursor = $cursor.Parent
    }
}
function Get-RunDirectory([string]$Path, [string]$Kind) {
    Assert-Condition (![string]::IsNullOrWhiteSpace($Path) -and [System.IO.Path]::IsPathFullyQualified($Path)) "run_directory_required"
    $full = [System.IO.Path]::GetFullPath($Path)
    Assert-Condition ([System.IO.Path]::GetFileName($full) -cmatch "^edupi-windows-upgrade-${Kind}-[1-9][0-9]*-[1-9][0-9]*$") "invalid_run_directory"
    Assert-Condition ([System.IO.Path]::GetDirectoryName($full) -eq [System.IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\', '/')) "run_directory_outside_runner_temp"
    Assert-NoReparseAncestor $full
    return $full
}
function Remove-OwnedDownload {
    $directory = Get-RunDirectory $env:WINDOWS_UPGRADE_DOWNLOAD_DIR "download"
    if (!(Test-Path -LiteralPath $directory)) { return }
    $marker = Join-Path $directory ".windows-upgrade-owned"
    Assert-Condition ((Test-Path -LiteralPath $marker -PathType Leaf) -and (Get-Content -LiteralPath $marker -Raw) -ceq $oldHash) "download_cleanup_marker_mismatch"
    Remove-Item -LiteralPath $directory -Recurse -Force
    Assert-Condition (!(Test-Path -LiteralPath $directory)) "download_cleanup_incomplete"
}
$evidenceDir = Get-RunDirectory $env:WINDOWS_UPGRADE_EVIDENCE_DIR "evidence"
Assert-Condition (Test-Path -LiteralPath $evidenceDir -PathType Container) "download_evidence_directory_missing"
$evidenceFile = Join-Path $evidenceDir "windows-upgrade-acceptance.json"
function Save-Evidence {
    $proof.updatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    $proof.phase = $phase
    $proof | ConvertTo-Json -Depth 18 | Set-Content -LiteralPath $evidenceFile -Encoding utf8
}
function Add-Check([string]$Name, [string]$Status, $Details) {
    $checks.Add(@{ name = $Name; status = $Status; details = $Details })
    Save-Evidence
}
function New-PrivateDirectory([string]$Path) {
    Assert-NoReparseAncestor $Path
    Assert-Condition (!(Test-Path -LiteralPath $Path)) "exclusive_task_directory_required"
    New-Item -ItemType Directory -Path $Path | Out-Null
    $script:ownedDirectories.Add($Path)
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & (Join-Path $env:SystemRoot "System32/icacls.exe") $Path "/inheritance:r" "/grant:r" "*${sid}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
    Assert-Condition ($LASTEXITCODE -eq 0) "private_directory_acl_failed"
    [IO.File]::WriteAllText((Join-Path $Path ".windows-upgrade-owned"), "$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT")
}
function Get-BaseEnvironment {
    $result = @{}
    # App/driver children never receive GITHUB_*, ACTIONS_*, GH_TOKEN, provider
    # credentials, proxy credentials, NODE_OPTIONS, or the user's Pi overrides.
    foreach ($name in @("SystemRoot", "WINDIR", "SystemDrive", "ComSpec", "TEMP", "TMP", "USERPROFILE",
        "USERNAME", "USERDOMAIN", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "ProgramData",
        "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramFiles(x86)",
        "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "OS")) {
        $value = [Environment]::GetEnvironmentVariable($name, "Process")
        if ($null -ne $value) { $result[$name] = $value }
    }
    $result.PATH = "$(Join-Path $env:SystemRoot 'System32');$env:SystemRoot"
    return $result
}
function Assert-NativeUpgradeGate($Shell, [string]$Runner) {
    Assert-Condition ($Runner -ceq "native-windows") "dedicated_native_runner_required"
    Assert-Condition ($Shell.status -ceq "passed" -and $Shell.shellWindowPresent -and
        $Shell.sidMatches -and $Shell.sessionMatches -and $Shell.currentSessionId -gt 0) "interactive_same_sid_shell_required"
    Assert-Condition ($Shell.currentTokenElevated -eq $false -and $Shell.shellTokenElevated -eq $false) "non_elevated_runner_and_shell_required"
}
function Get-ProfileEnvironmentNames {
    return @("EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_ROUTE1_ISOLATED_CANARY",
        "EDUPI_SAFE_MODE", "EDUPI_ISOLATED_UPDATE_FEED", "PI_CODING_AGENT_DIR", "PI_OFFLINE", "TEMP", "TMP",
        "WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER")
}
function Get-CurrentUserSid { return [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
function Read-UserEnvironment([string]$Name) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $false)
    try {
        $original = if ($key) { @($key.GetValueNames() | Where-Object { $_ -ieq $Name }) } else { @() }
        if (!$original.Count) { return @{ name = $Name; exists = $false; kind = $null; value = $null } }
        Assert-Condition ($original.Count -eq 1) "ambiguous_profile_environment"
        return @{ name = $original[0]; exists = $true; kind = [int]$key.GetValueKind($original[0])
            value = $key.GetValue($original[0], $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    } finally { if ($key) { $key.Dispose() } }
}
function Write-UserEnvironment($Entry) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment", $true)
    try {
        # Delete first to restore the exact original spelling as well as type.
        $key.DeleteValue($Entry.name, $false)
        if ($Entry.exists) { $key.SetValue($Entry.name, $Entry.value, [Microsoft.Win32.RegistryValueKind]$Entry.kind) }
        $key.Flush()
    } finally { $key.Dispose() }
}
function Test-EnvironmentEntryEqual($Left, $Right) {
    return $Left.name -ceq $Right.name -and $Left.exists -eq $Right.exists -and
        $Left.kind -eq $Right.kind -and
        ($Left.value | ConvertTo-Json -Compress) -ceq ($Right.value | ConvertTo-Json -Compress)
}
function Send-EnvironmentChange {
    if (!("WindowsUpgradeEnvironment" -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowsUpgradeEnvironment {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
    public static bool Broadcast() {
        UIntPtr result;
        return SendMessageTimeout(new IntPtr(0xffff), 0x001a, UIntPtr.Zero, "Environment", 2, 5000, out result) != IntPtr.Zero;
    }
}
'@
    }
    Assert-Condition ([WindowsUpgradeEnvironment]::Broadcast()) "profile_environment_broadcast_failed"
}
function Assert-CleanProfileEnvironment {
    # RunAsUser can rebuild a user environment. Reject ambient overrides and
    # credentials instead of copying, deleting or logging them. HKLM is read-only.
    $allowed = @("Path", "TEMP", "TMP", "PSModulePath", "OneDrive", "OneDriveConsumer", "OneDriveCommercial",
        "USERNAME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SystemRoot", "windir", "ComSpec",
        "OS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL", "PROCESSOR_REVISION",
        "NUMBER_OF_PROCESSORS", "PATHEXT", "USERDOMAIN", "USERDOMAIN_ROAMINGPROFILE")
    foreach ($root in @(
        @{ hive = [Microsoft.Win32.Registry]::CurrentUser; path = "Environment"; machine = $false },
        @{ hive = [Microsoft.Win32.Registry]::LocalMachine; path = "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"; machine = $true }
    )) {
        $key = $root.hive.OpenSubKey($root.path, $false)
        try {
            if (!$key) { continue }
            foreach ($name in $key.GetValueNames()) {
                if (!$root.machine -and $name -in (Get-ProfileEnvironmentNames)) {
                    $entry = Read-UserEnvironment $name
                    Assert-Condition ($entry.kind -in @([int][Microsoft.Win32.RegistryValueKind]::String,
                        [int][Microsoft.Win32.RegistryValueKind]::ExpandString)) "profile_environment_type_refused"
                    continue
                }
                Assert-Condition ($name -in $allowed) "ambient_profile_environment_refused"
            }
        } finally { if ($key) { $key.Dispose() } }
    }
}
function Save-ProfileJournal($Journal, [string]$File) {
    # This raw backup stays in the SID-private download directory, outside the
    # evidence glob. Write through before the first registry mutation.
    $text = $Journal | ConvertTo-Json -Depth 12
    $temporary = "$File.next"
    $stream = [IO.FileStream]::new($temporary, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($text)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
    # Same-directory replacement keeps the last valid backup readable if the
    # worker is interrupted while checkpointing process identities.
    [IO.File]::Move($temporary, $File, $true)
}
function Start-ProfileEnvironment([hashtable]$Values, [string]$File) {
    $names = @(Get-ProfileEnvironmentNames)
    Assert-Condition ($Values.Count -eq $names.Count -and @($Values.Keys | Where-Object { $_ -cnotin $names }).Count -eq 0) "unexpected_profile_environment_key"
    $entries = @($names | ForEach-Object { Read-UserEnvironment $_ })
    $journal = @{ schemaVersion = 1; runId = $env:GITHUB_RUN_ID; attempt = $env:GITHUB_RUN_ATTEMPT
        sid = Get-CurrentUserSid
        status = "prepared"; entries = $entries; taskRoot = $taskRoot; canaryRoot = $canaryRoot
        destination = $destination; processes = @(); directories = @($script:ownedDirectories.ToArray()) }
    Save-ProfileJournal $journal $File
    # Caller retains this journal even if a partial write or broadcast fails.
    $script:profileJournal = $journal
    foreach ($name in $names) {
        Write-UserEnvironment @{ name = $name; exists = $true; kind = [int][Microsoft.Win32.RegistryValueKind]::String; value = $Values[$name] }
    }
    Send-EnvironmentChange
    foreach ($name in $names) {
        $expected = @{ name = $name; exists = $true; kind = [int][Microsoft.Win32.RegistryValueKind]::String; value = $Values[$name] }
        Assert-Condition (Test-EnvironmentEntryEqual (Read-UserEnvironment $name) $expected) "profile_environment_set_readback_failed"
    }
    $journal.status = "active"
    Save-ProfileJournal $journal $File
    return $journal
}
function Restore-ProfileEnvironment($Journal, [string]$File) {
    $errors = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $Journal.entries) {
        try { Write-UserEnvironment $entry } catch { $errors.Add("profile_environment_restore_write_failed") }
    }
    try { Send-EnvironmentChange } catch { $errors.Add("profile_environment_restore_broadcast_failed") }
    foreach ($entry in $Journal.entries) {
        try { Assert-Condition (Test-EnvironmentEntryEqual $entry (Read-UserEnvironment $entry.name)) "profile_environment_restore_readback_failed" }
        catch { $errors.Add("profile_environment_restore_readback_failed") }
    }
    Assert-Condition ($errors.Count -eq 0) "profile_environment_restore_incomplete"
    $previous = $Journal.status
    $Journal.status = "restored"
    try { Save-ProfileJournal $Journal $File }
    catch { $Journal.status = $previous; throw }
}
function Save-RecoveryProcesses {
    if (!$profileJournal) { return }
    $profileJournal.processes = @($script:ownedProcesses | ForEach-Object {
        @{ id = $_.id; started = $_.started.ToString("o"); file = $_.file }
    })
    Save-ProfileJournal $profileJournal (Join-Path $env:WINDOWS_UPGRADE_DOWNLOAD_DIR "user-environment-backup.json")
}
function Remove-RecoveryDirectories($Journal) {
    $directories = @($Journal.directories)
    [array]::Reverse($directories)
    foreach ($directory in $directories) {
        $allowed = @($Journal.taskRoot, $Journal.canaryRoot,
            (Join-Path $env:APPDATA "com.abcwyc.pi-agent"), (Join-Path $env:LOCALAPPDATA "com.abcwyc.pi-agent"))
        Assert-Condition ($directory -in $allowed) "recovery_cleanup_path_refused"
        Assert-NoReparseAncestor $directory
        if (Test-Path -LiteralPath $directory) {
            Assert-Condition ((Get-Content -LiteralPath (Join-Path $directory ".windows-upgrade-owned") -Raw) -ceq
                "$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT") "recovery_cleanup_marker_mismatch"
            Remove-Item -LiteralPath $directory -Recurse -Force
        }
    }
}
function Recover-ProfileEnvironment([string]$Directory) {
    $file = Join-Path $Directory "user-environment-backup.json"
    if (!(Test-Path -LiteralPath $file)) { return }
    $journal = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json -AsHashtable
    Assert-Condition ($journal.schemaVersion -eq 1 -and $journal.runId -ceq $env:GITHUB_RUN_ID -and
        $journal.attempt -ceq $env:GITHUB_RUN_ATTEMPT -and
        $journal.sid -ceq (Get-CurrentUserSid)) "profile_recovery_identity_mismatch"
    Assert-Condition (@($journal.entries).Count -eq @(Get-ProfileEnvironmentNames).Count -and
        @($journal.entries | Where-Object { $_.name -notin (Get-ProfileEnvironmentNames) }).Count -eq 0 -and
        @($journal.entries.name | Sort-Object -Unique).Count -eq @(Get-ProfileEnvironmentNames).Count) "profile_recovery_keys_mismatch"
    $leasePath = Join-Path $env:USERPROFILE ".edupi-windows-upgrade-env.lock"
    if ($journal.status -ceq "restored") {
        if (Test-Path -LiteralPath $leasePath) {
            Assert-Condition ((Get-Content -LiteralPath $leasePath -Raw) -ceq "$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT") "profile_lease_identity_mismatch"
            Remove-Item -LiteralPath $leasePath -Force
        }
        Remove-RecoveryDirectories $journal
        return
    }
    Assert-Condition ([IO.Path]::GetDirectoryName($journal.taskRoot) -eq $env:USERPROFILE -and
        [IO.Path]::GetFileName($journal.taskRoot) -cmatch '^edupi-windows-upgrade-[a-f0-9]{32}$' -and
        [IO.Path]::GetDirectoryName($journal.canaryRoot) -eq $env:USERPROFILE -and
        [IO.Path]::GetFileName($journal.canaryRoot) -cmatch '^edupi-route1-canary-windows-upgrade-[a-f0-9]{32}$' -and
        $journal.destination -ceq (Join-Path $journal.taskRoot "application")) "profile_recovery_private_path_mismatch"
    Assert-NoReparseAncestor $journal.taskRoot
    # Opening the lease with FileShare.None proves the owning step has ended.
    $lease = [IO.FileStream]::new($leasePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $reader = [IO.StreamReader]::new($lease, [Text.Encoding]::UTF8, $true, 1024, $true)
        try { Assert-Condition ($reader.ReadToEnd() -ceq "$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT") "profile_lease_identity_mismatch" }
        finally { $reader.Dispose() }
        $script:destination = $journal.destination
        $script:taskRoot = $journal.taskRoot
        foreach ($record in $journal.processes) {
            $running = Get-Process -Id $record.id -ErrorAction SilentlyContinue
            if (!$running) { continue }
            [void]$running.SafeHandle
            if (!$running.HasExited -and $running.StartTime.ToUniversalTime() -eq [datetime]$record.started -and $running.Path -eq $record.file) {
                $script:ownedProcesses.Add(@{ process = $running; id = $running.Id; started = $running.StartTime.ToUniversalTime(); file = $running.Path })
            }
        }
        # A late NSIS child must be stopped before restoring roots. Retain a
        # handle and recheck birth/path for every process in the exclusive task
        # install/TEMP. Other executables require the saved exact identity.
        foreach ($row in @(Get-CimInstance Win32_Process)) {
            if (!$row.ExecutablePath -or !$row.ExecutablePath.StartsWith($journal.taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { continue }
            $running = Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue
            if (!$running) { continue }
            [void]$running.SafeHandle
            if (Test-CimProcessIdentity $row $running) {
                $script:ownedProcesses.Add(@{ process = $running; id = $running.Id; started = $running.StartTime.ToUniversalTime(); file = $running.Path })
            }
        }
        Stop-TaskProcesses
        $uninstallerPath = Join-Path $destination "uninstall.exe"
        if (Test-Path -LiteralPath $uninstallerPath) {
            $uninstaller = Start-OwnedProcess -File $uninstallerPath -Environment (Get-BaseEnvironment) -RawArguments "/S _?=$destination"
            Wait-OwnedProcess $uninstaller 120 "recovery_private_uninstaller_failed"
            Stop-TaskProcesses
        }
        Restore-ProfileEnvironment $journal $file
    } finally { $lease.Dispose() }
    Remove-Item -LiteralPath $leasePath -Force
    Remove-RecoveryDirectories $journal
}
function Get-ApplicationExecutable([ValidateSet("node", "cargo")][string]$Name) {
    $candidates = @(Get-Command -Name $Name -CommandType Application)
    Assert-Condition ($candidates.Count -gt 0) "application_executable_unavailable"
    # Get-Command can return every PATH match. Passing .Source on that array
    # binds several paths into one FileName and Process.Start returns Win32 2.
    $file = [string]$candidates[0].Source
    Assert-Condition ([System.IO.Path]::IsPathFullyQualified($file) -and
        (Test-Path -LiteralPath $file -PathType Leaf)) "application_executable_not_a_file"
    return $file
}
function Start-OwnedProcess([string]$File, [string[]]$Arguments, [hashtable]$Environment, [string]$RawArguments = "") {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $File
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.WorkingDirectory = $taskRoot
    $info.Environment.Clear()
    foreach ($entry in $Environment.GetEnumerator()) { $info.Environment[$entry.Key] = $entry.Value }
    if ($RawArguments) { $info.Arguments = $RawArguments }
    else { foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) } }
    $process = [System.Diagnostics.Process]::Start($info)
    [void]$process.SafeHandle
    $record = @{
        process = $process; id = $process.Id; started = $process.StartTime.ToUniversalTime()
        file = [System.IO.Path]::GetFullPath($File)
        stdout = $process.StandardOutput.ReadToEndAsync(); stderr = $process.StandardError.ReadToEndAsync()
    }
    $script:ownedProcesses.Add($record)
    if (Get-Variable -Name profileJournal -ValueOnly -ErrorAction SilentlyContinue) { Save-RecoveryProcesses }
    return $process
}
function Start-OldApplication {
    Assert-Condition ((Get-Item -LiteralPath $application).VersionInfo.ProductVersion -match '^0\.3\.116(?:\.0)?$') "only_frozen_116_may_be_launched"
    return Start-OwnedProcess -File $application -Environment $appEnvironment -Arguments @("--safe-mode")
}
function Wait-OwnedProcess($Process, [int]$Seconds, [string]$Code) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while (!$Process.WaitForExit(1000)) {
        if ([DateTime]::UtcNow -ge $deadline) { throw $Code }
    }
    Assert-Condition ($Process.ExitCode -eq 0) $Code
}
function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return $listener.LocalEndpoint.Port }
    finally { $listener.Stop() }
}
function Test-OwnedDebugEndpoint([string]$Value, [int]$Port) {
    $url = $null
    if (![Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$url)) { return $false }
    return $url.Scheme -ceq "ws" -and $url.Host -in @("127.0.0.1", "localhost", "[::1]") -and
        $url.Port -eq $Port -and !$url.UserInfo -and !$url.Query -and !$url.Fragment -and
        ($url.AbsolutePath -ceq "/devtools/browser" -or $url.AbsolutePath.StartsWith("/devtools/browser/"))
}
function Get-ShellEvidence {
    if (!("WindowsUpgradeShell" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class WindowsUpgradeShell {
    [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int infoClass, out int value, int length, out int returned);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static bool IsElevated(uint processId) {
        // Read only: PROCESS_QUERY_LIMITED_INFORMATION and TOKEN_QUERY.
        IntPtr process = OpenProcess(0x1000, false, processId), token = IntPtr.Zero;
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            if (!OpenProcessToken(process, 0x0008, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
            int value, returned;
            if (!GetTokenInformation(token, 20, out value, 4, out returned)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return value != 0;
        } finally {
            if (token != IntPtr.Zero) CloseHandle(token);
            CloseHandle(process);
        }
    }
}
'@
    }
    $handle = [WindowsUpgradeShell]::GetShellWindow()
    $current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $selfSession = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    $result = @{ status = "blocked"; shellWindowPresent = $handle -ne [IntPtr]::Zero; shellPid = $null
        hwnd = $handle.ToInt64().ToString("x"); currentSessionId = $selfSession
        currentTokenElevated = $null; shellTokenElevated = $null
        sidMatches = $false; sessionMatches = $false; code = "shell_window_missing" }
    if ($handle -eq [IntPtr]::Zero) { return $result }
    [uint32]$shellProcessId = 0
    [void][WindowsUpgradeShell]::GetWindowThreadProcessId($handle, [ref]$shellProcessId)
    Assert-Condition ($shellProcessId -gt 0) "shell_pid_unavailable"
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$shellProcessId"
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
    $result.shellPid = [int]$shellProcessId
    $result.currentTokenElevated = [WindowsUpgradeShell]::IsElevated([uint32]$PID)
    $result.shellTokenElevated = [WindowsUpgradeShell]::IsElevated($shellProcessId)
    $result.sidMatches = $owner.ReturnValue -eq 0 -and $owner.Sid -ceq $current
    $result.sessionMatches = [int]$process.SessionId -eq $selfSession
    if ($result.sidMatches -and $result.sessionMatches) { $result.status = "passed"; $result.code = $null }
    else { $result.code = "shell_user_or_session_mismatch" }
    return $result
}
function Assert-MicrosoftExecutable([string]$File) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    Assert-Condition ($signature.Status -eq "Valid" -and $null -ne $signature.SignerCertificate) "microsoft_authenticode_invalid"
    $subject = $signature.SignerCertificate.Subject
    Assert-Condition ($subject -match '(?:^|,\s*)CN=Microsoft Corporation(?:,|$)' -and
        $subject -match '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') "non_microsoft_driver_or_runtime"
    $version = (Get-Item -LiteralPath $File).VersionInfo.ProductVersion
    Assert-Condition ($version -match '^([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)(?:\s|$)') "executable_version_unavailable"
    return @{ version = $Matches[1]; sha256 = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
        authenticode = "Valid"; signer = "Microsoft Corporation" }
}
function Find-WebViewRuntime {
    # Read EdgeWebView/Application, not Microsoft/Edge/Application or the
    # browser's version. Force this exact runtime folder into the child env.
    $bases = @(
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft/EdgeWebView/Application"),
        (Join-Path $env:ProgramFiles "Microsoft/EdgeWebView/Application"),
        (Join-Path $env:LOCALAPPDATA "Microsoft/EdgeWebView/Application")
    )
    $candidates = @($bases | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Directory | Where-Object { $_.Name -match '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' }
    } | Sort-Object { [version]$_.Name } -Descending)
    foreach ($candidate in $candidates) {
        $file = Join-Path $candidate.FullName "msedgewebview2.exe"
        if (!(Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        $identity = Assert-MicrosoftExecutable $file
        Assert-Condition ($identity.version -eq $candidate.Name) "runtime_folder_version_mismatch"
        return @{ folder = $candidate.FullName; identity = $identity }
    }
    throw "webview2_runtime_missing"
}
function Get-EdgeDriverCandidates([string]$RuntimeVersion) {
    Assert-Condition ($RuntimeVersion -cmatch '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$') "invalid_runtime_version"
    $build = ($RuntimeVersion.Split(".") | Select-Object -First 3) -join "."
    $versions = [System.Collections.Generic.List[string]]::new()
    $versions.Add($RuntimeVersion)
    try {
        # Microsoft's major_WINDOWS endpoint returns UTF-16LE octet-stream.
        # The build-specific endpoint is not supported. Decode the BOM, then
        # still require all three build components to match this WebView2.
        $major = $RuntimeVersion.Split(".")[0]
        $response = Invoke-WebRequest -Uri "https://msedgedriver.microsoft.com/LATEST_RELEASE_${major}_WINDOWS" -TimeoutSec 30
        $response.RawContentStream.Position = 0
        $reader = [System.IO.StreamReader]::new($response.RawContentStream, [System.Text.Encoding]::UTF8, $true)
        try { $available = $reader.ReadToEnd().Trim() } finally { $reader.Dispose() }
        if ($available -match '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' -and $available.StartsWith("$build.") -and !$versions.Contains($available)) {
            $versions.Add($available)
        }
    } catch { } # The exact runtime version is still tried; no browser fallback.
    return $versions.ToArray()
}
function Install-EdgeDriver([string]$RuntimeVersion) {
    $build = ($RuntimeVersion.Split(".") | Select-Object -First 3) -join "."
    $versions = @(Get-EdgeDriverCandidates $RuntimeVersion)
    $archive = Join-Path $taskRoot "edgedriver.zip"
    $downloaded = $false
    foreach ($version in $versions) {
        try {
            Invoke-WebRequest -Uri "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip" -OutFile $archive -TimeoutSec 120
            $downloaded = $true
            break
        } catch { Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue }
    }
    Assert-Condition $downloaded "matching_webview2_driver_unavailable"
    $driver = Join-Path $taskRoot "msedgedriver.exe"
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $entries = @($zip.Entries | Where-Object { $_.FullName -ceq "msedgedriver.exe" })
        Assert-Condition ($entries.Count -eq 1 -and $entries[0].Length -gt 0 -and $entries[0].Length -lt 100MB) "invalid_edgedriver_archive"
        # Extract one exact file; do not materialize untrusted ZIP paths.
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $driver, $false)
    } finally { $zip.Dispose() }
    $identity = Assert-MicrosoftExecutable $driver
    Assert-Condition ((($identity.version.Split(".") | Select-Object -First 3) -join ".") -ceq $build) "webview2_driver_build_mismatch"
    Add-Check "edge-driver" "passed" $identity
    return $driver
}
function Test-CimProcessIdentity($Snapshot, $Process) {
    if ($null -eq $Snapshot -or $null -eq $Process -or $Process.HasExited) { return $false }
    # CIM stores microseconds; Process.StartTime can also retain the final
    # 100ns digit. This tolerance only removes that representation difference.
    $difference = [Math]::Abs(([datetime]$Snapshot.CreationDate).ToUniversalTime().Ticks -
        $Process.StartTime.ToUniversalTime().Ticks)
    return [int]$Snapshot.ProcessId -eq $Process.Id -and $difference -lt 10 -and
        $Snapshot.ExecutablePath -eq $Process.Path
}
function Capture-OwnedDescendants {
    $known = [System.Collections.Generic.HashSet[int]]::new()
    $identities = @{}
    foreach ($record in $script:ownedProcesses.ToArray()) {
        $running = Get-Process -Id $record.id -ErrorAction SilentlyContinue
        if (!$running) { continue }
        [void]$running.SafeHandle
        if (!$running.HasExited -and $running.StartTime.ToUniversalTime() -eq $record.started -and $running.Path -eq $record.file) {
            [void]$known.Add($record.id)
            $identities[[int]$record.id] = $record
        }
    }
    $snapshot = @(Get-CimInstance Win32_Process)
    $byId = @{}
    foreach ($row in $snapshot) { $byId[[int]$row.ProcessId] = $row }
    do {
        $added = $false
        foreach ($child in $snapshot) {
            if ($known.Contains([int]$child.ParentProcessId) -and !$known.Contains([int]$child.ProcessId)) {
                $parentRecord = $identities[[int]$child.ParentProcessId]
                $parent = Get-Process -Id $child.ParentProcessId -ErrorAction SilentlyContinue
                $running = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
                if (!$parent -or !$running) { continue }
                # Open and retain handles before sampling identity, so a
                # later PID reuse cannot turn cleanup into another process.
                [void]$parent.SafeHandle
                [void]$running.SafeHandle
                if (!(Test-CimProcessIdentity $byId[[int]$child.ParentProcessId] $parent) -or
                    !(Test-CimProcessIdentity $child $running) -or
                    $parent.StartTime.ToUniversalTime() -ne $parentRecord.started -or
                    $parent.Path -ne $parentRecord.file -or
                    $running.StartTime.ToUniversalTime() -lt $parent.StartTime.ToUniversalTime()) { continue }
                [void]$known.Add($running.Id)
                $record = @{ process = $running; id = $running.Id
                    started = $running.StartTime.ToUniversalTime(); file = $running.Path }
                $script:ownedProcesses.Add($record)
                $identities[[int]$running.Id] = $record
                $added = $true
            }
        }
    } while ($added)
    return ,$known
}
function Capture-PrivateTaskProcesses {
    if (!$taskRoot -or !(Test-Path -LiteralPath $taskRoot)) { return }
    Assert-NoReparseAncestor $taskRoot
    Assert-Condition ((Get-Content -LiteralPath (Join-Path $taskRoot ".windows-upgrade-owned") -Raw) -ceq
        "$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT") "private_process_discovery_marker_mismatch"
    $created = (Get-Item -LiteralPath $taskRoot).CreationTimeUtc
    $prefix = $taskRoot + [IO.Path]::DirectorySeparatorChar
    foreach ($row in @(Get-CimInstance Win32_Process)) {
        if (!$row.ExecutablePath -or !$row.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
            ([datetime]$row.CreationDate).ToUniversalTime() -lt $created) { continue }
        $running = Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue
        if (!$running) { continue }
        [void]$running.SafeHandle
        if (!(Test-CimProcessIdentity $row $running)) { continue }
        Assert-NoReparseAncestor $running.Path
        if (!@($script:ownedProcesses | Where-Object {
            $_.id -eq $running.Id -and $_.started -eq $running.StartTime.ToUniversalTime() -and $_.file -eq $running.Path
        }).Count) {
            $script:ownedProcesses.Add(@{ process = $running; id = $running.Id
                started = $running.StartTime.ToUniversalTime(); file = $running.Path })
        }
    }
}
function Stop-TaskProcesses {
    # Include a native App that launched before a failed WebDriver handshake.
    # Path equality restricts this discovery to the exclusive task install.
    if ($destination) {
        $expected = Join-Path $destination "pi-agent-desktop.exe"
        foreach ($candidate in @(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue)) {
            [void]$candidate.SafeHandle
            if ($candidate.Path -eq $expected -and !($script:ownedProcesses | Where-Object { $_.id -eq $candidate.Id })) {
                $script:ownedProcesses.Add(@{ process = $candidate; id = $candidate.Id
                    started = $candidate.StartTime.ToUniversalTime(); file = $expected })
            }
        }
    }
    for ($round = 0; $round -lt 6; $round++) {
        # NSIS can outlive its old parent. Discover only exact handles born in
        # the exclusive marked install/TEMP, including a late automatic App.
        Capture-PrivateTaskProcesses
        [void](Capture-OwnedDescendants)
        $records = @($script:ownedProcesses.ToArray())
        [array]::Reverse($records)
        foreach ($record in $records) {
            $current = $record.process
            [void]$current.SafeHandle
            if ($current.HasExited) { continue }
            Assert-Condition ($current.StartTime.ToUniversalTime() -eq $record.started -and $current.Path -eq $record.file) "owned_pid_identity_changed"
            # Kill() uses this retained Windows process handle. It does not expand
            # a PID into an unverified process tree.
            $current.Kill()
            Assert-Condition ($current.WaitForExit(10000)) "owned_process_cleanup_incomplete"
        }
        Capture-PrivateTaskProcesses
        if (!@($script:ownedProcesses | Where-Object { !$_.process.HasExited }).Count) { return }
    }
    throw "private_processes_not_quiescent"
}
function Test-HistoricalParent($Record, $Child) {
    $birth = ([datetime]$Child.CreationDate).ToUniversalTime()
    if ([int]$Child.ParentProcessId -ne $Record.id -or $birth -lt $Record.started) { return $false }
    # Retained handles preserve the actual exit boundary after the old App
    # exits. A reused PID cannot establish a relationship after that boundary.
    if ($Record.process.HasExited) { return $birth -le $Record.process.ExitTime.ToUniversalTime() }
    return $Record.process.StartTime.ToUniversalTime() -eq $Record.started -and $Record.process.Path -eq $Record.file
}
function Assert-UpgradeProcessUser($Snapshot, $Process) {
    $owner = Invoke-CimMethod -InputObject $Snapshot -MethodName GetOwnerSid
    Assert-Condition ($owner.ReturnValue -eq 0 -and $owner.Sid -ceq (Get-CurrentUserSid) -and
        [int]$Snapshot.SessionId -eq [Diagnostics.Process]::GetCurrentProcess().SessionId) "upgrade_process_user_or_session_mismatch"
    Assert-Condition (!(Get-ProcessElevation $Process.Id)) "upgrade_process_elevated"
}
function Get-ProcessElevation([int]$ProcessId) { return [WindowsUpgradeShell]::IsElevated([uint32]$ProcessId) }
function Capture-UpgradeTransition($OldRecord) {
    if (!$script:upgradeBoundary) { return }
    $tempPrefix = (Join-Path $taskRoot "temp") + [IO.Path]::DirectorySeparatorChar
    foreach ($row in @(Get-CimInstance Win32_Process | Sort-Object @{ Expression = {
        if ($_.ExecutablePath -eq $application) { 1 } else { 0 }
    } }, CreationDate)) {
        if (!$row.ExecutablePath -or ([datetime]$row.CreationDate).ToUniversalTime() -lt $script:upgradeBoundary) { continue }
        $isApp = $row.ExecutablePath -eq $application -and [int]$row.ProcessId -ne $OldRecord.id
        $isInstaller = $row.ExecutablePath.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetExtension($row.ExecutablePath) -ieq ".exe"
        if (!$isApp -and !$isInstaller) { continue }
        $running = Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue
        if (!$running) { continue }
        [void]$running.SafeHandle
        if (!(Test-CimProcessIdentity $row $running)) { continue }
        $parents = @($script:ownedProcesses | Where-Object {
            ($_.id -eq $OldRecord.id -or ($_.ContainsKey("upgradeRole") -and $_.upgradeRole -ceq "verified-installer")) -and
            (Test-HistoricalParent $_ $row)
        })
        if ($isInstaller) {
            if (!$parents.Count -or ($script:upgradeInstaller -and $script:upgradeInstaller.id -eq $running.Id -and
                $script:upgradeInstaller.started -eq $running.StartTime.ToUniversalTime())) { continue }
            Assert-NoReparseAncestor $running.Path
            Assert-Condition ((Get-FileHash -LiteralPath $running.Path -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $targetHash) "observed_nsis_digest_mismatch"
            $command = [string]$row.CommandLine
            Assert-Condition ($command -cmatch '(?:^|\s)/UPDATE(?:\s|$)' -and
                $command -cmatch '(?:^|\s)/R(?:\s|$)' -and $command -cmatch '(?:^|\s)/(?:P|S)(?:\s|$)' -and
                $command -cmatch '(?:^|\s)/ARGS(?:\s|$)' -and $command.Contains("--safe-mode")) "native_nsis_update_restart_arguments_missing"
            Assert-UpgradeProcessUser $row $running
            $existing = @($script:ownedProcesses | Where-Object {
                $_.id -eq $running.Id -and $_.started -eq $running.StartTime.ToUniversalTime() -and $_.file -eq $running.Path
            })
            $record = if ($existing.Count) { $existing[0] } else {
                @{ process = $running; id = $running.Id; started = $running.StartTime.ToUniversalTime(); file = $running.Path }
            }
            $record.upgradeRole = "verified-installer"
            if (!$existing.Count) { $script:ownedProcesses.Add($record) }
            $script:upgradeInstaller = $record
            Save-RecoveryProcesses
        } elseif ($isApp) {
            Assert-Condition ($parents.Count -gt 0 -and @($parents | Where-Object {
                $_.ContainsKey("upgradeRole") -and $_.upgradeRole -ceq "verified-installer"
            }).Count -gt 0) "automatic_restart_installer_parent_unverified"
            Assert-Condition ($OldRecord.process.HasExited -and
                $running.StartTime.ToUniversalTime() -ge $OldRecord.process.ExitTime.ToUniversalTime()) "new_app_predates_old_exit"
            Assert-UpgradeProcessUser $row $running
            Assert-Condition ((Get-Item -LiteralPath $running.Path).VersionInfo.ProductVersion -match '^0\.3\.117(?:\.0)?$') "automatic_restart_version_mismatch"
            if (!$script:newApplication) {
                $existing = @($script:ownedProcesses | Where-Object {
                    $_.id -eq $running.Id -and $_.started -eq $running.StartTime.ToUniversalTime() -and $_.file -eq $running.Path
                })
                $script:newApplication = if ($existing.Count) { $existing[0] } else {
                    @{ process = $running; id = $running.Id; started = $running.StartTime.ToUniversalTime(); file = $running.Path }
                }
                $script:newApplication.upgradeRole = "automatic-app"
                $script:upgradeInstaller = @($parents | Where-Object {
                    $_.ContainsKey("upgradeRole") -and $_.upgradeRole -ceq "verified-installer"
                } | Sort-Object started -Descending)[0]
                if (!$existing.Count) { $script:ownedProcesses.Add($script:newApplication) }
                Save-RecoveryProcesses
            }
            Assert-Condition ($script:newApplication.id -eq $running.Id -and
                $script:newApplication.started -eq $running.StartTime.ToUniversalTime()) "multiple_automatic_apps_refused"
        }
    }
}
function Assert-InstalledCoreBytes([string]$Version) {
    Assert-Condition ((Get-Item -LiteralPath $application).VersionInfo.ProductVersion -match ("^" + [regex]::Escape($Version) + "(?:\.0)?$")) "installed_target_version_mismatch"
    $resources = Join-Path $destination "resources"
    $component = Get-Content -LiteralPath (Join-Path $resources "component-versions.json") -Raw | ConvertFrom-Json
    Assert-Condition ($component.appVersion -ceq $Version) "installed_component_version_mismatch"
    $coreRoot = Join-Path $resources "edupi-core"
    $manifest = Get-Content -LiteralPath (Join-Path $coreRoot "contracts/edupi-desktop-component-manifest.json") -Raw | ConvertFrom-Json
    $runtime = Get-Content -LiteralPath (Join-Path $coreRoot "contracts/edupi-core-runtime-component-manifest.json") -Raw | ConvertFrom-Json
    Assert-Condition ($manifest.component_manifest_hash -ceq "sha256:e8d0cdf0196ae84a3d5bb5b9552934bcfefc5111ba3ba4882b99ff4b4abfb770" -and
        $runtime.component_manifest_hash -ceq "sha256:46252d3917be4035a8bc9bf4b779b6d6621db0a3caadb71a38bd2da63ffa0bc2") "installed_core98_manifest_mismatch"
    $native = Get-Content -LiteralPath (Join-Path $coreRoot "contracts/windows-runtime-attestation-v1.json") -Raw | ConvertFrom-Json
    Assert-Condition ($native.status -ceq "approved" -and
        $native.binary_relative_path -ceq "native/windows-runtime-attestation/approved/windows_runtime_attestation.node") "native_source_contract_mismatch"
    $nativeFile = Join-Path $coreRoot $native.binary_relative_path
    Assert-Condition ((Get-Item -LiteralPath $nativeFile).Length -eq $native.binary_size -and
        "sha256:$((Get-FileHash -LiteralPath $nativeFile -Algorithm SHA256).Hash.ToLowerInvariant())" -ceq $native.binary_sha256) "native_source_bytes_mismatch"
}
function Start-WebViewHelper($Config) {
    $file = Join-Path $taskRoot ("helper-" + [guid]::NewGuid().ToString("N") + ".json")
    $Config | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $file -Encoding utf8
    $environment = Get-BaseEnvironment
    $environment.WINDOWS_UPGRADE_RUN_CONFIG = $file
    return Start-OwnedProcess -File $helperNode -Environment $environment -Arguments @( (Join-Path $PSScriptRoot "windows-upgrade-webdriver.mjs") )
}
function Restart-AttachDriver([int]$TauriPort, [int]$EdgePort) {
    # Abandon the old remote session without DELETE: its original WebView has
    # exited and a late protocol close might target the new window. Retire only
    # our retained driver handles, never the already restarted App/WebView.
    foreach ($record in @($script:ownedProcesses | Where-Object { $_.file -in @($tauriDriver, $edgeDriver) })) {
        $process = $record.process
        [void]$process.SafeHandle
        if ($process.HasExited) { continue }
        Assert-Condition ($process.StartTime.ToUniversalTime() -eq $record.started -and $process.Path -eq $record.file) "attach_driver_identity_changed"
        $process.Kill()
        Assert-Condition ($process.WaitForExit(10000)) "old_attach_driver_stop_failed"
    }
    $process = Start-OwnedProcess -File $tauriDriver -Environment $appEnvironment -Arguments @(
        "--port", "$TauriPort", "--native-port", "$EdgePort", "--native-driver", $edgeDriver)
    $deadline = [datetime]::UtcNow.AddSeconds(30)
    while ([datetime]::UtcNow -lt $deadline -and !$process.HasExited) {
        try {
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:$TauriPort/status" -TimeoutSec 2
            if ($status.value.ready) { return }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    throw "new_attach_driver_unavailable"
}
function Wait-NewApplicationDebugPort {
    $deadline = [datetime]::UtcNow.AddSeconds(120)
    while ([datetime]::UtcNow -lt $deadline) {
        Assert-Condition (!$script:newApplication.process.HasExited) "automatic_117_exited_before_attach"
        [void](Capture-OwnedDescendants)
        $owned = @($script:ownedProcesses | Where-Object { !$_.process.HasExited -and $_.started -ge $script:newApplication.started })
        $rows = @(Get-CimInstance Win32_Process)
        $newTree = [Collections.Generic.HashSet[int]]::new()
        [void]$newTree.Add($script:newApplication.id)
        do {
            $added = $false
            foreach ($row in $rows) {
                if (!$newTree.Contains([int]$row.ParentProcessId) -or $newTree.Contains([int]$row.ProcessId)) { continue }
                $parent = @($owned | Where-Object { $_.id -eq [int]$row.ParentProcessId })
                $child = @($owned | Where-Object { $_.id -eq [int]$row.ProcessId -and (Test-CimProcessIdentity $row $_.process) })
                if ($parent.Count -eq 1 -and $child.Count -eq 1 -and (Test-HistoricalParent $parent[0] $row)) {
                    [void]$newTree.Add([int]$row.ProcessId); $added = $true
                }
            }
        } while ($added)
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq $debugPort })
        if ($listeners.Count -gt 0) {
            Assert-Condition (@($listeners | Where-Object {
                !$newTree.Contains([int]$_.OwningProcess) -or $_.LocalAddress -notin @("127.0.0.1", "::1")
            }).Count -eq 0) "new_debug_port_not_new_app_owned_loopback"
            $info = Invoke-RestMethod -Uri "http://127.0.0.1:$debugPort/json/version" -TimeoutSec 3
            Assert-Condition (Test-OwnedDebugEndpoint $info.webSocketDebuggerUrl $debugPort) "new_debug_endpoint_mismatch"
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "automatic_117_owned_debug_port_unavailable"
}
function Save-NativeDiagnostics {
    $snapshot = @(Get-CimInstance Win32_Process)
    $byId = @{}
    foreach ($row in $snapshot) { $byId[[int]$row.ProcessId] = $row }
    $proof.nativeProcesses = @($script:ownedProcesses | ForEach-Object {
        $record = $_
        $name = [System.IO.Path]::GetFileName($record.file)
        $role = if ($record.file -eq $application) { "installed-app" }
            elseif ($record.file -eq $helperNode) { "node-helper" }
            elseif ($record.file -eq $tauriDriver) { "tauri-driver" }
            elseif ($record.file -eq $edgeDriver) { "edge-driver" }
            elseif ($name -eq "msedgewebview2.exe") { "webview2-runtime" }
            elseif ($destination -and $record.file.StartsWith($destination, [StringComparison]::OrdinalIgnoreCase)) { "installed-resource" }
            elseif ($name -in @("conhost.exe", "OpenConsole.exe", "pi-agent-desktop.exe")) { $name }
            else { "other-owned" }
        $exited = $record.process.HasExited
        $command = if ($byId.ContainsKey([int]$record.id)) { [string]$byId[[int]$record.id].CommandLine } else { "" }
        $ports = @([regex]::Matches($command, '(?:^|\s)--remote-debugging-port=(\d+)(?:\s|$)') | ForEach-Object { [int]$_.Groups[1].Value })
        @{ role = $role; pid = $record.id; exited = $exited; exitCode = if ($exited) { $record.process.ExitCode } else { $null }
            debugPorts = $ports; debugPipe = $command.Contains("--remote-debugging-pipe")
            privateUserDataArgument = $taskRoot -and $command.Contains($taskRoot) }
    })
    $ownedIds = @($script:ownedProcesses | ForEach-Object { $_.id })
    $proof.nativeListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -in $ownedIds } |
        ForEach-Object { @{ pid = $_.OwningProcess; port = $_.LocalPort; loopback = $_.LocalAddress -in @("127.0.0.1", "::1") } })
    $proof.browserPolicies = @(
        foreach ($key in @("HKLM:\Software\Policies\Microsoft\Edge", "HKCU:\Software\Policies\Microsoft\Edge",
            "HKLM:\Software\Policies\Microsoft\Edge\WebView2", "HKCU:\Software\Policies\Microsoft\Edge\WebView2")) {
            $values = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
            foreach ($name in @("RemoteDebuggingAllowed", "DeveloperToolsAvailability")) {
                if ($values -and $values.PSObject.Properties[$name] -and $values.$name -is [int]) {
                    @{ policy = $name; value = $values.$name; machine = $key.StartsWith("HKLM:") }
                }
            }
        }
    )
    $proof.nativeStartupCodes = @(
        foreach ($base in @((Join-Path $env:APPDATA "com.abcwyc.pi-agent"), (Join-Path $env:LOCALAPPDATA "com.abcwyc.pi-agent"))) {
            foreach ($file in @(Get-ChildItem -LiteralPath $base -Filter "startup-diagnostics.jsonl" -Recurse -File -ErrorAction SilentlyContinue)) {
                foreach ($line in @(Get-Content -LiteralPath $file.FullName -Tail 20)) {
                    try {
                        $entry = $line | ConvertFrom-Json
                        $safe = @{}
                        foreach ($key in @("stage", "component", "errorCode")) {
                            if ($entry.PSObject.Properties[$key] -and [string]$entry.$key -cmatch '^[a-zA-Z0-9_-]{1,100}$') { $safe[$key] = $entry.$key }
                        }
                        if ($safe.Count) { $safe }
                    } catch { }
                }
            }
        }
    )
}
function Read-OwnedCoreStatus {
    $probe = @{ status = "blocked"; code = "owned_core_status_unavailable"; uiEvidence = $false }
    $nodeIds = @($script:ownedProcesses | Where-Object {
        [System.IO.Path]::GetFileName($_.file) -eq "node.exe" -and
        $_.file.StartsWith($destination, [StringComparison]::OrdinalIgnoreCase) -and !($_.process.HasExited)
    } | ForEach-Object { $_.id })
    foreach ($listener in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
        $_.OwningProcess -in $nodeIds -and $_.LocalAddress -eq "127.0.0.1"
    })) {
        $origin = "http://127.0.0.1:$($listener.LocalPort)"
        try {
            $identity = Invoke-WebRequest -Uri "$origin/api/desktop/identity" -Headers @{ Origin = $origin } -TimeoutSec 3
            if ($identity.StatusCode -ne 204) { continue }
            $status = Invoke-RestMethod -Uri "$origin/api/edupi/status?summary=1" -Headers @{ Origin = $origin } -TimeoutSec 60
            if ($status.core.status -eq "ready" -and $status.projection.status -eq "ready" -and
                $status.compatibility.actual.coreCommit -ceq $coreCommit -and $status.externalSend -eq $false -and
                $status.core.capabilities.g1_processor -eq "activation_pending" -and $status.core.validationMode -eq "bundled") {
                $probe = @{ status = "passed"; coreCommit = $coreCommit; core = "ready"; projection = "ready"
                    g1 = "activation_pending"; externalSend = $false; uiEvidence = $false }
                break
            }
        } catch { }
    }
    $proof.independentCoreProbe = $probe
}

if ($CleanupDownloadOnly) {
    # always(): recover raw HKCU values before deleting their private backup.
    try {
        $directory = Get-RunDirectory $env:WINDOWS_UPGRADE_DOWNLOAD_DIR "download"
        Recover-ProfileEnvironment $directory
        Remove-OwnedDownload
        @{ status = "passed"; rawBackupUploaded = $false; actualUpgradePassed = $false } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceDir "windows-upgrade-recovery.json") -Encoding utf8
        exit 0
    } catch {
        @{ status = "blocked"; code = Get-SafeCode $_; actualUpgradePassed = $false
            diagnostic = Get-SafeDiagnostic $_ "always-recovery" } | ConvertTo-Json -Depth 10 |
            Set-Content -LiteralPath (Join-Path $evidenceDir "windows-upgrade-recovery.json") -Encoding utf8
        Write-Error (Get-SafeCode $_); exit 1
    }
}

Save-Evidence
try {
    Assert-Condition $IsWindows "windows_only"
    Assert-Condition ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "X64") "windows_x64_required"
    Assert-Condition ([string]::IsNullOrEmpty($env:GH_TOKEN) -and [string]::IsNullOrEmpty($env:GITHUB_TOKEN)) "download_token_must_not_enter_acceptance_step"
    $downloadDir = Get-RunDirectory $env:WINDOWS_UPGRADE_DOWNLOAD_DIR "download"
    $download = Get-Content -LiteralPath (Join-Path $evidenceDir "windows-upgrade-download.json") -Raw | ConvertFrom-Json
    Assert-Condition ($download.status -eq "downloaded_and_verified" -and $download.mode -eq $Mode -and
        $download.old.sourceSha -ceq $oldSource -and $download.asset.id -ceq "756302414") "verified_download_evidence_required"
    $installer = Join-Path $downloadDir "EduPi_0.3.116_x64-setup.exe"
    Assert-Condition ((Get-Item -LiteralPath $installer).Length -eq $download.asset.size -and
        (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $oldHash) "frozen_installer_digest_mismatch"
    Add-Check "exact-116-installer" "passed" @{ sourceSha = $oldSource; sha256 = $oldHash }
    $phase = "shell"
    try { $proof.shell = Get-ShellEvidence }
    catch { $proof.shell = @{ status = "blocked"; code = Get-SafeCode $_; diagnostic = Get-SafeDiagnostic $_ $phase } }
    Save-Evidence
    if ($Mode -ceq "upgrade") {
        Set-Phase "native-upgrade-gate"
        Assert-NativeUpgradeGate $proof.shell $env:WINDOWS_UPGRADE_RUNNER
        Assert-CleanProfileEnvironment
        Add-Check "native-upgrade-gate" "passed" @{ dedicated = $true; nonElevated = $true; sameSidAndSession = $true
            ambientProfileEnvironmentChecked = $true }
    }

    $phase = "exclusive-environment"
    # This entry is for a disposable Windows acceptance user. Refuse an
    # existing EduPi installation/state rather than disturb its registry,
    # native preferences or teacher profile. No process is killed by name.
    Assert-Condition (@(Get-Process -Name "pi-agent-desktop" -ErrorAction SilentlyContinue).Count -eq 0) "existing_edupi_process_refused"
    foreach ($registryRoot in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")) {
        foreach ($key in @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue)) {
            $entry = Get-ItemProperty -LiteralPath $key.PSPath
            if ($entry.PSObject.Properties["DisplayName"] -and $entry.DisplayName -ceq "EduPi") { throw "existing_edupi_installation_refused" }
        }
    }
    foreach ($folder in @("Desktop", "CommonDesktopDirectory", "Programs", "CommonPrograms")) {
        $location = [Environment]::GetFolderPath([Environment+SpecialFolder]::$folder)
        if ($location) {
            Assert-Condition (!(Test-Path -LiteralPath (Join-Path $location "EduPi.lnk")) -and
                !(Test-Path -LiteralPath (Join-Path $location "EduPi"))) "existing_edupi_shortcut_refused"
        }
    }
    $id = [guid]::NewGuid().ToString("N")
    $taskRoot = Join-Path $env:USERPROFILE "edupi-windows-upgrade-$id"
    $canaryRoot = Join-Path $env:USERPROFILE "edupi-route1-canary-windows-upgrade-$id"
    Assert-Condition ([System.IO.Path]::GetDirectoryName($canaryRoot) -eq $env:USERPROFILE -and
        [System.IO.Path]::GetFileName($canaryRoot) -cmatch '^edupi-route1-canary-[a-z0-9-]+$') "invalid_direct_home_canary"
    $drive = Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($taskRoot).Substring(0, 1))
    $proof.disk = @{ freeBeforeBytes = $drive.Free }
    Assert-Condition ($drive.Free -gt 4GB) "insufficient_private_install_space"
    New-PrivateDirectory $taskRoot
    New-PrivateDirectory $canaryRoot
    New-Item -ItemType Directory -Path (Join-Path $taskRoot "temp") | Out-Null
    foreach ($base in @((Join-Path $env:APPDATA "com.abcwyc.pi-agent"), (Join-Path $env:LOCALAPPDATA "com.abcwyc.pi-agent")) | Select-Object -Unique) {
        Assert-Condition (!(Test-Path -LiteralPath $base)) "existing_edupi_native_state_refused"
        New-PrivateDirectory $base
    }
    $agentDir = Join-Path $canaryRoot ".edupi/agent"
    New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
    '{"providers":{}}' | Set-Content -LiteralPath (Join-Path $agentDir "models.json") -Encoding utf8
    '{}' | Set-Content -LiteralPath (Join-Path $agentDir "auth.json") -Encoding utf8
    $appEnvironment = Get-BaseEnvironment
    $appEnvironment.EDUPI_PROJECT_ROOT = $canaryRoot
    $appEnvironment.EDUPI_DATA_ROOT = $canaryRoot
    $appEnvironment.EDUPI_DATA_ALLOWED_ROOT = $env:USERPROFILE
    $appEnvironment.EDUPI_ROUTE1_ISOLATED_CANARY = "1"
    $appEnvironment.EDUPI_SAFE_MODE = "1"
    $appEnvironment.PI_CODING_AGENT_DIR = $agentDir
    $appEnvironment.PI_OFFLINE = "1"
    $appEnvironment.TEMP = Join-Path $taskRoot "temp"
    $appEnvironment.TMP = $appEnvironment.TEMP
    $appEnvironment.WEBVIEW2_USER_DATA_FOLDER = Join-Path $taskRoot "webview2"
    $debugPort = Get-FreePort
    $appEnvironment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$debugPort"
    $helperNode = Get-ApplicationExecutable "node"
    if ($Mode -ceq "upgrade") {
        Set-Phase "public-117-target"
        $inputEnvironment = @{ WINDOWS_UPGRADE_MODE = "upgrade" }
        foreach ($name in @("TARGET_RELEASE_ID", "TARGET_ASSET_ID", "TARGET_SOURCE_SHA", "TARGET_ASSET_SHA256", "COHORT_URL")) {
            $inputEnvironment["WINDOWS_UPGRADE_$name"] = [Environment]::GetEnvironmentVariable("WINDOWS_UPGRADE_$name", "Process")
        }
        $targetHelper = Start-WebViewHelper @{ action = "verify-target"; evidenceDir = $evidenceDir; inputEnvironment = $inputEnvironment }
        Wait-OwnedProcess $targetHelper 900 "public_target_contract_or_download_failed"
        $targetProof = Get-Content -LiteralPath (Join-Path $evidenceDir "windows-upgrade-target.json") -Raw | ConvertFrom-Json -AsHashtable
        Assert-Condition ($targetProof.status -ceq "passed" -and $targetProof.sha256 -ceq $targetHash -and
            $targetProof.sourceSha -ceq $targetSource -and $targetProof.cohortUrl -ceq $cohortUrl) "public_target_proof_mismatch"
        $proof.upgrade.target = $targetProof
        Add-Check "public-117-target" "passed" $targetProof
        $appEnvironment.EDUPI_ISOLATED_UPDATE_FEED = $cohortUrl
    }
    Add-Check "isolated-environment" "passed" @{ canaryDirectHomeChild = $true; syntheticOnly = $true
        appEnvironmentKeys = @($appEnvironment.Keys | Sort-Object); seededViaApi = $false; realModels = $false }

    $phase = "install-116"
    $destination = Join-Path $taskRoot "application"
    # NSIS requires /D to be last and unquoted. This is a native process
    # command line, never a shell expression. Paths are task allocated.
    $installation = Start-OwnedProcess -File $installer -Environment $appEnvironment -RawArguments "/S /D=$destination"
    Wait-OwnedProcess $installation 240 "old_installer_failed"
    Stop-TaskProcesses
    $application = Join-Path $destination "pi-agent-desktop.exe"
    Assert-Condition (Test-Path -LiteralPath $application -PathType Leaf) "installed_application_missing"
    Assert-Condition ((Get-Item -LiteralPath $application).VersionInfo.ProductVersion -match '^0\.3\.116(?:\.0)?$') "installed_116_version_mismatch"
    Assert-InstalledCoreBytes "0.3.116"
    Add-Check "installed-116-core98-bytes" "passed" @{ appVersion = "0.3.116"; coreCommit = $coreCommit; nativeBytes = "approved" }

    $phase = "webview2-runtime-driver"
    $webview = Find-WebViewRuntime
    Add-Check "webview2-runtime" "passed" $webview.identity
    $appEnvironment.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $webview.folder
    if ($Mode -ceq "upgrade") {
        Set-Phase "profile-environment-set"
        $leasePath = Join-Path $env:USERPROFILE ".edupi-windows-upgrade-env.lock"
        Assert-NoReparseAncestor $leasePath
        $profileLease = [IO.FileStream]::new($leasePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $leaseBytes = [Text.Encoding]::UTF8.GetBytes("$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT")
        $profileLease.Write($leaseBytes, 0, $leaseBytes.Length)
        $profileLease.Flush($true)
        $values = @{}
        foreach ($name in (Get-ProfileEnvironmentNames)) { $values[$name] = $appEnvironment[$name] }
        $sid = Get-CurrentUserSid
        & (Join-Path $env:SystemRoot "System32/icacls.exe") $downloadDir "/inheritance:r" "/grant:r" "*${sid}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
        Assert-Condition ($LASTEXITCODE -eq 0) "profile_journal_directory_acl_failed"
        $profileJournal = Start-ProfileEnvironment $values (Join-Path $downloadDir "user-environment-backup.json")
        $proof.profileEnvironment = @{ changed = $true; setReadback = "passed"; broadcast = "passed"
            upgradeInheritanceTested = $false; rawBackupUploaded = $false }
        Add-Check "profile-environment-set" "passed" @{ exactKeys = @(Get-ProfileEnvironmentNames); readback = $true; broadcast = $true }
    }
    $edgeDriver = Install-EdgeDriver $webview.identity.version
    $phase = "tauri-driver"
    $tauriRoot = Join-Path $taskRoot "tauri-driver"
    $cargoEnv = Get-BaseEnvironment
    $cargoEnv.PATH = $env:PATH
    foreach ($name in @("RUSTUP_HOME", "CARGO_HOME", "RUSTUP_TOOLCHAIN")) {
        $value = [Environment]::GetEnvironmentVariable($name, "Process")
        if ($value) { $cargoEnv[$name] = $value }
    }
    $cargo = Start-OwnedProcess -File (Get-ApplicationExecutable "cargo") -Environment $cargoEnv -Arguments @(
        "install", "tauri-driver", "--version", "=$driverVersion", "--locked", "--root", $tauriRoot,
        "--target-dir", (Join-Path $taskRoot "cargo-target")
    )
    Wait-OwnedProcess $cargo 900 "pinned_tauri_driver_install_failed"
    $crateMetadata = Get-Content -LiteralPath (Join-Path $tauriRoot ".crates2.json") -Raw | ConvertFrom-Json -AsHashtable
    $crateName = "tauri-driver $driverVersion (registry+https://github.com/rust-lang/crates.io-index)"
    Assert-Condition ($crateMetadata.installs.ContainsKey($crateName) -and
        $crateMetadata.installs[$crateName].bins -contains "tauri-driver.exe") "tauri_driver_provenance_mismatch"
    $tauriDriver = Join-Path $tauriRoot "bin/tauri-driver.exe"
    Add-Check "tauri-driver" "passed" @{ version = $driverVersion; lockedCargoInstall = $true
        primarySource = "tauri-apps/tauri:tauri-driver-v2.0.4"
        sha256 = (Get-FileHash -LiteralPath $tauriDriver -Algorithm SHA256).Hash.ToLowerInvariant() }

    Set-Phase "real-webview-ports"
    $tauriPort = Get-FreePort
    $edgePort = Get-FreePort
    Assert-Condition ($tauriPort -ne $edgePort -and $tauriPort -ne $debugPort -and $edgePort -ne $debugPort) "port_allocation_collision"
    Set-Phase "real-webview-driver-start"
    $driver = Start-OwnedProcess -File $tauriDriver -Environment $appEnvironment -Arguments @(
        "--port", "$tauriPort", "--native-port", "$edgePort", "--native-driver", $edgeDriver
    )
    Set-Phase "real-webview-driver-ready"
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline -and !$driver.HasExited) {
        try {
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:$tauriPort/status" -TimeoutSec 2
            if ($status.value.ready) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
    Assert-Condition $ready "tauri_or_edge_driver_not_ready"
    Set-Phase "real-webview-116-start"
    # Microsoft's documented attach strategy avoids DevToolsActivePort
    # discovery in the launch strategy. This is an owned 116 preflight launch,
    # never a replacement for an updater's automatic 117 restart.
    $oldApplication = Start-OldApplication
    $proof.oldLaunch = @{ version = "0.3.116"; pid = $oldApplication.Id; method = "owned_preflight_safe_mode"
        tokenElevated = [WindowsUpgradeShell]::IsElevated([uint32]$oldApplication.Id) }
    Set-Phase "real-webview-owned-debug-port"
    $debugReady = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while ([DateTime]::UtcNow -lt $deadline) {
        Assert-Condition (!$oldApplication.HasExited) "old_116_exited_before_attach"
        $ownedIds = Capture-OwnedDescendants
        $debugListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq $debugPort })
        $proof.debugProbe = @{ listenerCount = $debugListeners.Count; configuredPort = $debugPort }
        if ($debugListeners.Count) {
            Assert-Condition (@($debugListeners | Where-Object {
                !$ownedIds.Contains([int]$_.OwningProcess) -or $_.LocalAddress -notin @("127.0.0.1", "::1")
            }).Count -eq 0) "debug_port_not_owned_loopback"
            try {
                $debugInfo = Invoke-RestMethod -Uri "http://127.0.0.1:$debugPort/json/version" -TimeoutSec 3
                $proof.debugProbe.versionResponse = $true
                $proof.debugProbe.browserWebSocketMatches = Test-OwnedDebugEndpoint $debugInfo.webSocketDebuggerUrl $debugPort
                if ($proof.debugProbe.browserWebSocketMatches) { $debugReady = $true; break }
            } catch { $proof.debugProbe.requestErrorType = $_.Exception.GetType().FullName }
        }
        Start-Sleep -Milliseconds 300
    }
    if (!$debugReady -and $proof.oldLaunch.tokenElevated -and $proof.shell.shellTokenElevated) {
        throw "elevated_shell_and_host_ignore_webview_environment_overrides"
    }
    Assert-Condition $debugReady "owned_webview_debug_port_unavailable"
    Set-Phase "real-webview-config"
    $runConfig = Join-Path $taskRoot "webview-config.json"
    @{ action = "preflight"; endpoint = "http://127.0.0.1:$tauriPort"; application = $application; dataRoot = $canaryRoot
        runtimeVersion = $webview.identity.version; evidenceDir = $evidenceDir
        attachPort = $debugPort; expectedPid = $oldApplication.Id; expectedVersion = "0.3.116" } |
        ConvertTo-Json | Set-Content -LiteralPath $runConfig -Encoding utf8
    Set-Phase "real-webview-helper-environment"
    $helperEnvironment = Get-BaseEnvironment
    $helperEnvironment.WINDOWS_UPGRADE_RUN_CONFIG = $runConfig
    Set-Phase "real-webview-helper-resolve"
    $helperNode = Get-ApplicationExecutable "node"
    Set-Phase "real-webview-helper-start"
    $helper = Start-OwnedProcess -File $helperNode -Environment $helperEnvironment -Arguments @(
        (Join-Path $PSScriptRoot "windows-upgrade-webdriver.mjs")
    )
    Set-Phase "real-webview-helper-monitor"
    $deadline = [DateTime]::UtcNow.AddSeconds(600)
    $samples = 0
    $debugPortObserved = $false
    while (!$helper.WaitForExit(500)) {
        Assert-Condition ([DateTime]::UtcNow -lt $deadline) "webview_preflight_timeout"
        $ownedIds = Capture-OwnedDescendants
        $listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $ownedIds.Contains([int]$_.OwningProcess) })
        if ($listeners.Count) {
            $samples++
            Assert-Condition (@($listeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }).Count -eq 0) "non_loopback_driver_or_debug_listener"
            if (@($listeners | Where-Object { $_.LocalPort -eq $debugPort }).Count) { $debugPortObserved = $true }
        }
    }
    Assert-Condition ($samples -gt 0) "live_listener_evidence_missing"
    Set-Phase "real-webview-read-proof"
    $webviewProof = Get-Content -LiteralPath (Join-Path $evidenceDir "windows-upgrade-webview.json") -Raw | ConvertFrom-Json
    Save-NativeDiagnostics
    $webviewStatus = if ($webviewProof.status -ceq "passed" -and $helper.ExitCode -eq 0 -and $webviewProof.sessionClosed) { "passed" }
        elseif ($webviewProof.status -ceq "failed") { "failed" } else { "blocked" }
    Add-Check "real-webview-preflight" $webviewStatus @{ evidence = "windows-upgrade-webview.json"
        loopbackOnly = $true; liveListenerSamples = $samples; configuredDebugPortObserved = $debugPortObserved
        actualUpgradePassed = $false }
    if ($Mode -ceq "upgrade") {
        Assert-Condition ($webviewStatus -ceq "passed" -and !$oldApplication.HasExited) "real_preflight_required_before_upgrade"
        Assert-NativeUpgradeGate (Get-ShellEvidence) $env:WINDOWS_UPGRADE_RUNNER
        Set-Phase "old-ui-native-upgrade"
        $config = Get-Content -LiteralPath $runConfig -Raw | ConvertFrom-Json -AsHashtable
        $config.action = "request-upgrade"
        $config.target = $targetProof
        $config.baselineFile = Join-Path $taskRoot "synthetic-baseline.json"
        $config.triggerFile = Join-Path $taskRoot "ui-trigger.json"
        $config.ackFile = Join-Path $taskRoot "native-observer-ack.json"
        $oldRecords = @($script:ownedProcesses | Where-Object { $_.id -eq $oldApplication.Id -and $_.process -eq $oldApplication })
        Assert-Condition ($oldRecords.Count -eq 1) "retained_old_application_record_required"
        $oldRecord = $oldRecords[0]
        Save-RecoveryProcesses
        $triggerHelper = Start-WebViewHelper $config
        $deadline = [datetime]::UtcNow.AddSeconds(660)
        while ([datetime]::UtcNow -lt $deadline) {
            [void](Capture-OwnedDescendants)
            Save-RecoveryProcesses
            if (!$script:upgradeBoundary -and (Test-Path -LiteralPath $config.triggerFile)) {
                $trigger = Get-Content -LiteralPath $config.triggerFile -Raw | ConvertFrom-Json
                Assert-Condition ($trigger.oldPid -eq $oldApplication.Id -and
                    [datetime]$trigger.triggeredAt -ge $triggerHelper.StartTime.ToUniversalTime() -and
                    [datetime]$trigger.triggeredAt -le [datetime]::UtcNow) "ui_trigger_boundary_mismatch"
                $script:upgradeBoundary = ([datetime]$trigger.triggeredAt).ToUniversalTime()
            }
            Capture-UpgradeTransition $oldRecord
            if ($script:upgradeInstaller -and $oldApplication.HasExited -and !(Test-Path -LiteralPath $config.ackFile)) {
                @{ oldPid = $oldApplication.Id; oldExited = $true; installerVerified = $true } |
                    ConvertTo-Json | Set-Content -LiteralPath $config.ackFile -Encoding utf8
            }
            if ($triggerHelper.HasExited -and $triggerHelper.ExitCode -ne 0) { throw "old_ui_native_upgrade_helper_blocked" }
            if ($script:newApplication -and $triggerHelper.HasExited -and $script:upgradeInstaller.process.HasExited) { break }
            Start-Sleep -Milliseconds 200
        }
        Assert-Condition ($triggerHelper.HasExited -and $triggerHelper.ExitCode -eq 0) "old_ui_native_upgrade_timeout"
        $triggerProof = Get-Content -LiteralPath (Join-Path $evidenceDir "windows-upgrade-trigger.json") -Raw | ConvertFrom-Json -AsHashtable
        Assert-Condition ($triggerProof.status -ceq "passed" -and $triggerProof.uiContinueClicked -and
            $triggerProof.oldSessionAbandonedAfterNativeExit -and $triggerProof.oldSessionCloseIssued -eq $false -and
            $triggerProof.seededViaApi) "old_ui_upgrade_evidence_missing"
        Add-Check "old-ui-native-upgrade" "passed" @{ evidence = "windows-upgrade-trigger.json"; uiContinueClicked = $true
            nativeSignatureRequired = $true; installerSha256 = $targetHash; scriptedTargetInstall = $false }
        Set-Phase "automatic-117-restart"
        Assert-Condition ($null -ne $script:newApplication -and $oldApplication.HasExited -and
            !$script:newApplication.process.HasExited -and $script:upgradeInstaller.process.HasExited -and
            $script:upgradeInstaller.process.ExitCode -eq 0) "automatic_native_restart_not_verified"
        $observer = @{ status = "passed"; oldPid = $oldApplication.Id; newPid = $script:newApplication.id
            installerPid = $script:upgradeInstaller.id; installerSha256 = $targetHash; installerExitCode = 0
            sameExecutablePath = $true; sameSidAndSession = $true; nonElevated = $true; automaticRestart = $true
            newPidParent = "verified-native-nsis"; targetManuallyLaunched = $false }
        $proof.upgrade.observer = $observer
        Add-Check "automatic-117-restart" "passed" $observer
        Assert-InstalledCoreBytes "0.3.117"
        Add-Check "installed-117-core98-bytes" "passed" @{ version = "0.3.117"; sourceSha = $targetSource
            sourceBinding = "public_exact_asset_then_native_verified_nsis"; coreCommit = $coreCommit; nativeBytes = "approved" }
        Set-Phase "same-object-upgrade-readback"
        Restart-AttachDriver $tauriPort $edgePort
        Wait-NewApplicationDebugPort
        $config.action = "verify-upgrade"
        $config.expectedVersion = "0.3.117"
        $config.expectedPid = $script:newApplication.id
        $config.observer = $observer
        $verifyHelper = Start-WebViewHelper $config
        while (!$verifyHelper.WaitForExit(500)) {
            Assert-Condition ([datetime]::UtcNow -lt $deadline.AddSeconds(240)) "upgrade_readback_timeout"
            [void](Capture-OwnedDescendants)
        }
        $readback = Get-Content -LiteralPath (Join-Path $evidenceDir "windows-upgrade-readback.json") -Raw | ConvertFrom-Json -AsHashtable
        Assert-Condition ($verifyHelper.ExitCode -eq 0 -and $readback.status -ceq "passed" -and $readback.sessionClosed -and
            $readback.connectionStrategy -ceq "attach_only" -and $readback.manuallyLaunched -eq $false) "upgrade_attach_or_readback_blocked"
        $proof.profileEnvironment.upgradeInheritanceTested = $true
        $proof.upgrade.status = "runtime_checks_passed_pending_cleanup_and_environment_restore"
        Add-Check "same-object-upgrade-readback" "passed" @{ evidence = "windows-upgrade-readback.json"; seededViaApi = $true; uiSaved = $false }
    }
} catch {
    $diagnostic = Get-SafeDiagnostic $_ $phase
    if ($script:ownedProcesses.Count) {
        try { Save-NativeDiagnostics } catch { $proof.nativeDiagnosticError = Get-SafeDiagnostic $_ "native-diagnostics" }
        if ($phase -eq "real-webview-owned-debug-port") {
            try { Read-OwnedCoreStatus } catch { $proof.coreDiagnosticError = Get-SafeDiagnostic $_ "owned-core-probe" }
        }
    }
    Add-Check $phase "blocked" @{ code = Get-SafeCode $_; diagnostic = $diagnostic }
    Write-Output (@{ status = "blocked"; diagnostic = $diagnostic } | ConvertTo-Json -Depth 10 -Compress)
} finally {
    $cleanupErrors = [System.Collections.Generic.List[string]]::new()
    try { Stop-TaskProcesses } catch { $cleanupErrors.Add((Get-SafeCode $_)) }
    if ($destination -and (Test-Path -LiteralPath (Join-Path $destination "uninstall.exe"))) {
        try {
            $uninstaller = Start-OwnedProcess -File (Join-Path $destination "uninstall.exe") -Environment $appEnvironment -RawArguments "/S _?=$destination"
            Wait-OwnedProcess $uninstaller 120 "private_uninstaller_failed"
        } catch { $cleanupErrors.Add((Get-SafeCode $_)) }
    }
    try { Stop-TaskProcesses } catch { $cleanupErrors.Add((Get-SafeCode $_)) }
    $remaining = @($script:ownedProcesses | ForEach-Object {
        $p = Get-Process -Id $_.id -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime.ToUniversalTime() -eq $_.started) { $p.Id }
    })
    $proof.cleanup.remainingOwnedProcesses = $remaining
    if ($profileJournal) {
        $proof.profileEnvironment.changed = $true
        if ($remaining.Count -eq 0 -and $cleanupErrors.Count -eq 0) {
            try {
                Restore-ProfileEnvironment $profileJournal (Join-Path $env:WINDOWS_UPGRADE_DOWNLOAD_DIR "user-environment-backup.json")
                $proof.profileEnvironment.restore = "passed"
                $proof.profileEnvironment.restoreBroadcast = "passed"
                Add-Check "profile-environment-restored" "passed" @{ rawValuesKindsNamesAndAbsenceVerified = $true; broadcast = $true }
            } catch {
                $proof.profileEnvironment.restore = "failed"
                $cleanupErrors.Add((Get-SafeCode $_))
                Add-Check "profile-environment-restored" "failed" @{ code = Get-SafeCode $_ }
            }
        } else {
            $proof.profileEnvironment.restore = "pending_safe_process_cleanup"
            $cleanupErrors.Add("profile_restore_requires_stopped_owned_processes")
        }
    }
    if ($profileLease) {
        $profileLease.Dispose()
        if (!$profileJournal -or $profileJournal.status -ceq "restored") {
            try { Remove-Item -LiteralPath (Join-Path $env:USERPROFILE ".edupi-windows-upgrade-env.lock") -Force }
            catch { $cleanupErrors.Add("profile_lease_cleanup_failed") }
        }
    }
    if ($remaining.Count -eq 0 -and $cleanupErrors.Count -eq 0) {
        $removed = [System.Collections.Generic.List[string]]::new()
        $directories = @($script:ownedDirectories.ToArray())
        [array]::Reverse($directories)
        foreach ($directory in $directories) {
            try {
                Assert-NoReparseAncestor $directory
                if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
                Assert-Condition (!(Test-Path -LiteralPath $directory)) "owned_directory_cleanup_incomplete"
                $removed.Add($directory.Replace($env:USERPROFILE, "<userprofile>").Replace($env:LOCALAPPDATA, "<localappdata>").Replace($env:APPDATA, "<appdata>"))
            } catch { $cleanupErrors.Add((Get-SafeCode $_)) }
        }
        $proof.cleanup.removed = @($removed)
    }
    $proof.cleanup.errors = @($cleanupErrors)
    $proof.cleanup.status = if ($remaining.Count -eq 0 -and $cleanupErrors.Count -eq 0) { "passed" } else { "failed" }
    if ($proof.ContainsKey("disk")) {
        $proof.disk.freeAfterBytes = (Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($env:USERPROFILE).Substring(0, 1))).Free
    }
    $outcome = Get-AcceptanceOutcome -Mode $Mode -Shell $proof.shell.status -Cleanup $proof.cleanup.status -Checks $checks.ToArray()
    foreach ($entry in $outcome.GetEnumerator()) { $proof[$entry.Key] = $entry.Value }
    if ($proof.actualUpgradePassed) { $proof.upgrade.status = "actual_upgrade_passed" }
    elseif ($Mode -ceq "upgrade") { $proof.upgrade.status = "blocked"; $proof.upgrade.actualUpgradePassed = $false }
    Save-Evidence
}
Write-Output ($proof | Select-Object mode, status, preflightPassed, actualUpgradePassed | ConvertTo-Json -Compress)
if ($proof.status -cnotin @("preflight_passed", "upgrade_passed")) { exit 1 }
