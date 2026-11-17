#requires -Version 7.4
[CmdletBinding()]
param(
    [ValidateSet("preflight", "upgrade")][string]$Mode = "preflight",
    [switch]$CleanupDownloadOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# No profile environment is changed in preflight. In particular this script
# does not pretend that a job environment will survive NSIS /R RunAsUser.
# Upgrade deliberately fails closed until the missing executor is implemented.
$oldHash = "73f83b411b0d461fe5bb6c632a57d02799a4efc0f930104a6b1e8ef3b6dbaa06"
$oldSource = "13de2b53d08d487a6abceb91ec1e37bd919af690"
$coreCommit = "98e4f7cd0c31dd30954574d2040bb1b948cdd954"
$driverVersion = "2.0.4"
$script:ownedProcesses = [System.Collections.Generic.List[object]]::new()
$script:ownedDirectories = [System.Collections.Generic.List[string]]::new()
$taskRoot = $null
$destination = $null
$canaryRoot = $null
$appEnvironment = $null
$phase = "inputs"
$checks = [System.Collections.Generic.List[object]]::new()
$proof = @{
    schemaVersion = 1; mode = $Mode; status = "blocked"; preflightPassed = $false; actualUpgradePassed = $false
    old = @{ version = "0.3.116"; releaseId = "447334004"; assetId = "756302414"; sourceSha = $oldSource; sha256 = $oldHash }
    shell = @{ status = "not_checked" }; checks = $checks
    profileEnvironment = @{ changed = $false; upgradeInheritanceTested = $false }
    upgrade = @{ status = "not_executed"; code = "upgrade_executor_not_implemented"; missing = @(
        "same_sid_user_profile_environment_set_and_restore",
        "public_117_exact_assets_and_immutable_cohort_content",
        "old_ui_check_update_continue_native_download_signature_nsis",
        "new_pid_same_path_117_auto_relaunch_and_attach_without_launch",
        "post_upgrade_source_root_core98_and_same_object_data_model_readback"
    ) }
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
    $oldChecks = @($Checks | Where-Object { $_.name -ne "upgrade-executor" })
    $passed = $oldChecks.Count -gt 0 -and @($oldChecks | Where-Object { $_.status -ne "passed" }).Count -eq 0 -and
        $Shell -ceq "passed" -and $Cleanup -ceq "passed"
    $failed = $Cleanup -ceq "failed" -or @($oldChecks | Where-Object { $_.status -ceq "failed" }).Count -gt 0
    return @{ status = if ($failed) { "failed" } elseif ($Mode -ceq "preflight" -and $passed) { "preflight_passed" } else { "blocked" }
        preflightPassed = $passed; actualUpgradePassed = $false }
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
if ($CleanupDownloadOnly) {
    # Called by the workflow's always() step even if download or preflight fails.
    try { Remove-OwnedDownload; exit 0 }
    catch { Write-Error (Get-SafeCode $_); exit 1 }
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
    return $process
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
function Get-ShellEvidence {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowsUpgradeShell {
    [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@
    $handle = [WindowsUpgradeShell]::GetShellWindow()
    $current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $selfSession = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    $result = @{ status = "blocked"; shellWindowPresent = $handle -ne [IntPtr]::Zero; shellPid = $null
        hwnd = $handle.ToInt64().ToString("x"); currentSessionId = $selfSession
        sidMatches = $false; sessionMatches = $false; code = "shell_window_missing" }
    if ($handle -eq [IntPtr]::Zero) { return $result }
    [uint32]$shellProcessId = 0
    [void][WindowsUpgradeShell]::GetWindowThreadProcessId($handle, [ref]$shellProcessId)
    Assert-Condition ($shellProcessId -gt 0) "shell_pid_unavailable"
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$shellProcessId"
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
    $result.shellPid = [int]$shellProcessId
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
    $appEnvironment.WEBVIEW2_USER_DATA_FOLDER = Join-Path $taskRoot "webview2"
    $debugPort = Get-FreePort
    $appEnvironment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$debugPort"
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
    $resources = Join-Path $destination "resources"
    $component = Get-Content -LiteralPath (Join-Path $resources "component-versions.json") -Raw | ConvertFrom-Json
    Assert-Condition ($component.appVersion -ceq "0.3.116") "installed_component_version_mismatch"
    $coreRoot = Join-Path $resources "edupi-core"
    $manifest = Get-Content -LiteralPath (Join-Path $coreRoot "contracts/edupi-desktop-component-manifest.json") -Raw | ConvertFrom-Json
    $runtime = Get-Content -LiteralPath (Join-Path $coreRoot "contracts/edupi-core-runtime-component-manifest.json") -Raw | ConvertFrom-Json
    Assert-Condition ($manifest.component_manifest_hash -ceq "sha256:e8d0cdf0196ae84a3d5bb5b9552934bcfefc5111ba3ba4882b99ff4b4abfb770" -and
        $runtime.component_manifest_hash -ceq "sha256:46252d3917be4035a8bc9bf4b779b6d6621db0a3caadb71a38bd2da63ffa0bc2") "installed_core98_manifest_mismatch"
    $native = Get-Content -LiteralPath (Join-Path $coreRoot "contracts/windows-runtime-attestation-v1.json") -Raw | ConvertFrom-Json
    Assert-Condition ($native.status -ceq "approved" -and $native.binary_relative_path -ceq "native/windows-runtime-attestation/approved/windows_runtime_attestation.node") "native_source_contract_mismatch"
    $nativeFile = Join-Path $coreRoot $native.binary_relative_path
    Assert-Condition ((Get-Item -LiteralPath $nativeFile).Length -eq $native.binary_size -and
        "sha256:$((Get-FileHash -LiteralPath $nativeFile -Algorithm SHA256).Hash.ToLowerInvariant())" -ceq $native.binary_sha256) "native_source_bytes_mismatch"
    Add-Check "installed-116-core98-bytes" "passed" @{ appVersion = "0.3.116"; coreCommit = $coreCommit; nativeBytes = "approved" }

    $phase = "webview2-runtime-driver"
    $webview = Find-WebViewRuntime
    Add-Check "webview2-runtime" "passed" $webview.identity
    $appEnvironment.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $webview.folder
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
    Set-Phase "real-webview-config"
    $runConfig = Join-Path $taskRoot "webview-config.json"
    @{ endpoint = "http://127.0.0.1:$tauriPort"; application = $application; dataRoot = $canaryRoot
        runtimeVersion = $webview.identity.version; evidenceDir = $evidenceDir } |
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
    $proof.nativeProcesses = @($script:ownedProcesses | ForEach-Object {
        $record = $_
        $role = if ($record.file -eq $application) { "installed-app" }
            elseif ($record.file -eq $helperNode) { "node-helper" }
            elseif ($record.file -eq $tauriDriver) { "tauri-driver" }
            elseif ($record.file -eq $edgeDriver) { "edge-driver" }
            elseif ([System.IO.Path]::GetFileName($record.file) -eq "msedgewebview2.exe") { "webview2-runtime" }
            elseif ($record.file.StartsWith($destination, [StringComparison]::OrdinalIgnoreCase)) { "installed-resource" }
            else { "other-owned" }
        $exited = $record.process.HasExited
        @{ role = $role; pid = $record.id; exited = $exited; exitCode = if ($exited) { $record.process.ExitCode } else { $null } }
    })
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
    $webviewStatus = if ($webviewProof.status -ceq "passed" -and $helper.ExitCode -eq 0 -and $webviewProof.sessionClosed) { "passed" }
        elseif ($webviewProof.status -ceq "failed") { "failed" } else { "blocked" }
    Add-Check "real-webview-preflight" $webviewStatus @{ evidence = "windows-upgrade-webview.json"
        loopbackOnly = $true; liveListenerSamples = $samples; configuredDebugPortObserved = $debugPortObserved
        actualUpgradePassed = $false }
    if ($Mode -eq "upgrade") { Add-Check "upgrade-executor" "blocked" @{ code = "upgrade_executor_not_implemented" } }
} catch {
    $diagnostic = Get-SafeDiagnostic $_ $phase
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
    Save-Evidence
}
Write-Output ($proof | Select-Object mode, status, preflightPassed, actualUpgradePassed | ConvertTo-Json -Compress)
if ($proof.status -cne "preflight_passed") { exit 1 }
