#!/usr/bin/env bash
set -euo pipefail

# Install and restart the real Debian application. This is Core startup and
# storage acceptance; it does not exercise a teacher workflow or an update.
exec python3 - "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" <<'PY_LINUX_INSTALL'
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request


class InstallFailure(RuntimeError):
    """A fixed diagnostic code owned by this script, safe for CI evidence."""


def check(condition, code):
    if not condition:
        raise InstallFailure(code)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def verify_manifests(resources, compat):
    pin = compat["core_runtime"]
    check(re.fullmatch(r"[a-f0-9]{40}", pin["core_commit"]), "invalid_core_commit_pin")
    check(pin["component_manifest_path"] == "contracts/edupi-desktop-component-manifest.json",
          "unexpected_desktop_manifest_path")
    core = resources / "edupi-core"
    for relative, field in [
        (pin["component_manifest_path"], "component_manifest_hash"),
        ("contracts/edupi-core-runtime-component-manifest.json", "runtime_component_manifest_hash"),
    ]:
        manifest = read_json(core / relative)
        recorded = manifest.pop("component_manifest_hash")
        canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        calculated = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        check(recorded == calculated == pin[field], field + "_mismatch")
    check(read_json(core / "contracts/edupi-core-runtime-v1-hash.json")["schema_hash"]
          == pin["runtime_schema_hash"], "runtime_schema_hash_mismatch")
    return pin


def verify_status(payload, pin):
    check(payload["core"]["status"] == "ready"
          and payload["projection"]["status"] == "ready", "core_or_projection_not_ready")
    check(payload["core"]["validationMode"] == "bundled", "core_not_bundled")
    check(payload["externalSend"] is False, "external_send_enabled")
    fields = {"coreCommit": "core_commit", "componentManifestHash": "component_manifest_hash",
              "runtimeComponentManifestHash": "runtime_component_manifest_hash"}
    for source in [payload["core"], payload["compatibility"]["expected"],
                   payload["compatibility"]["actual"]]:
        check(all(source.get(key) == pin[field] for key, field in fields.items()),
              "running_core_pin_mismatch")


def read_storage(data):
    database = data / ".edupi/runtime/core-runtime-v1.sqlite"
    check(database.is_file() and database.stat().st_size > 0, "core_database_missing")
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        check(connection.execute("PRAGMA quick_check").fetchall() == [("ok",)],
              "core_database_check_failed")
        tables = [row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        check(tables, "core_database_schema_missing")
        return {"quickCheck": "ok", "userVersion": connection.execute("PRAGMA user_version").fetchone()[0],
                "tables": tables, "fileIdentity": [database.stat().st_dev, database.stat().st_ino]}


def live_session(session):
    # Inspect IDs and state only; command lines can contain credentials.
    rows = subprocess.check_output(["ps", "-axo", "pid=,pgid=,stat="], text=True).splitlines()
    result = []
    for pid, pgid, state in (row.split() for row in rows):
        if state.startswith("Z"):
            continue
        try:
            if os.getsid(int(pid)) == session:
                result.append((int(pid), int(pgid)))
        except ProcessLookupError:
            pass
    return result


def stop_application(process):
    if process is None:
        return
    # Popen owns this session. The shell puts Node in its own process group,
    # which must also be stopped before the database is read or reopened.
    for action in [signal.SIGTERM, signal.SIGKILL]:
        for group in {group for _, group in live_session(process.pid)}:
            if not any(current == group for _, current in live_session(process.pid)):
                continue
            try:
                os.killpg(group, action)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            process.poll()
            if not live_session(process.pid):
                process.wait(timeout=1)
                return
            time.sleep(0.1)
    raise InstallFailure("installed_application_cleanup_failed")


def wait_for_core(process, config, root, label, pin, previous_instance=None):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        check(process.poll() is None, "installed_application_exited_before_ready")
        # This fresh private prefs file is written by the installed shell's
        # choose_port(), including fallback ports outside the default range.
        for prefs in config.rglob("ui-prefs.json"):
            try:
                port = read_json(prefs).get("serverPort")
                if type(port) is not int or not 0 < port < 65536:
                    continue
                origin = "http://127.0.0.1:" + str(port)
                with urllib.request.urlopen(origin + "/api/desktop/identity", timeout=2) as response:
                    if response.status != 204:
                        continue
                    instance = response.headers.get("x-pi-desktop-instance", "")
                    if not re.fullmatch(r"[a-f0-9]{64}", instance) or instance == previous_instance:
                        continue
                remaining = max(1, min(60, deadline - time.monotonic()))
                with urllib.request.urlopen(origin + "/api/edupi/status?summary=1", timeout=remaining) as response:
                    payload = json.load(response)
                (root / (label + "-status.json")).write_text(json.dumps(payload), encoding="utf-8")
            except (OSError, ValueError, urllib.error.URLError):
                continue
            if payload.get("core", {}).get("status") == "ready" and payload.get("projection", {}).get("status") == "ready":
                verify_status(payload, pin)
                check(process.poll() is None, "installed_application_exited_during_ready")
                return {"core": "ready", "projection": "ready", "validationMode": "bundled",
                        "port": port, "processSession": process.pid, "instanceId": instance}
        time.sleep(1)
    raise InstallFailure("installed_core_readiness_deadline")


def main(desktop):
    check(sys.platform == "linux", "linux_runner_required")
    os.umask(0o077)
    root = Path(tempfile.mkdtemp(prefix="edupi-linux-install-", dir=os.environ["RUNNER_TEMP"])).resolve()
    evidence_path = root / "evidence.json"
    if os.environ.get("GITHUB_ENV"):
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
            output.write("EDUPI_LINUX_INSTALL_EVIDENCE=" + str(evidence_path) + "\n")
    evidence = {"scope": "linux_deb_install_core_startup", "status": "failed",
                "limits": ["teacher_workflow_not_exercised", "updater_not_exercised"]}
    if re.fullmatch(r"[a-f0-9]{40}", os.environ.get("GITHUB_SHA", "")):
        evidence["desktopCommit"] = os.environ["GITHUB_SHA"]
    process = None
    stage = "package_identity"
    result = 1
    try:
        if os.environ.get("EDUPI_DEB"):
            packages = [Path(os.environ["EDUPI_DEB"]).resolve()]
        else:
            directory = Path(os.environ.get("EDUPI_LINUX_INSTALLER_DIR",
                desktop / "src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb"))
            packages = list(directory.glob("*_amd64.deb"))
        check(len(packages) == 1 and packages[0].is_file(), "expected_one_debian_package")
        deb = packages[0].resolve()
        expected = os.environ["EDUPI_TEST_RELEASE"].removeprefix("v")
        package, version, architecture = [
            subprocess.check_output(["dpkg-deb", "-f", str(deb), field], text=True).strip()
            for field in ["Package", "Version", "Architecture"]
        ]
        check(re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", package), "invalid_package_name")
        check(version == expected and architecture == "amd64", "debian_package_identity_mismatch")
        digest = hashlib.sha256()
        with deb.open("rb") as package_bytes:
            for chunk in iter(lambda: package_bytes.read(1024 * 1024), b""):
                digest.update(chunk)
        evidence["package"] = {"name": package, "version": version, "architecture": architecture,
                               "sha256": digest.hexdigest()}
        stage = "install"
        with (root / "install.log").open("w") as output:
            subprocess.run(["sudo", "apt-get", "install", "--yes", str(deb)], check=True,
                           stdout=output, stderr=subprocess.STDOUT)
        installed = subprocess.check_output(
            ["dpkg-query", "-W", "-f=${Status}\\t${Version}\\t${Architecture}", package], text=True)
        check(installed.strip() == "install ok installed\t" + expected + "\tamd64",
              "installed_package_identity_mismatch")
        files = [Path(line) for line in subprocess.check_output(["dpkg", "-L", package], text=True).splitlines()]
        binaries = [path for path in files if path.parent == Path("/usr/bin") and path.is_file()]
        nodes = [path for path in files if str(path).endswith("/resources/node/node")]
        check(len(binaries) == len(nodes) == 1, "installed_executable_or_node_missing")
        binary, node = binaries[0], nodes[0]
        check(os.access(binary, os.X_OK) and os.access(node, os.X_OK), "installed_binary_not_executable")
        resources = node.parent.parent
        stage = "core_manifests"
        pin = verify_manifests(resources, read_json(Path(os.environ.get(
            "EDUPI_LINUX_COMPAT_PATH", desktop / "contracts/edupi-core-compat.json"))))
        evidence["corePin"] = {field: pin[field] for field in [
            "core_commit", "component_manifest_hash", "runtime_component_manifest_hash", "runtime_schema_hash"]}
        home, data, config = root / "home", root / "data", root / "config"
        for directory in [home / ".pi/agent", data, config, root / "cache", root / "xdg-data", root / "run"]:
            directory.mkdir(parents=True, mode=0o700)
        # Whitelist the environment: build credentials and external Core/data
        # roots must never reach the installed application.
        environment = {"PATH": os.environ["PATH"], "LANG": "C.UTF-8", "HOME": str(home),
            "XDG_CONFIG_HOME": str(config), "XDG_DATA_HOME": str(root / "xdg-data"),
            "XDG_CACHE_HOME": str(root / "cache"), "XDG_RUNTIME_DIR": str(root / "run"),
            "EDUPI_DATA_ROOT": str(data), "EDUPI_PROJECT_ROOT": str(data),
            "EDUPI_DATA_ALLOWED_ROOT": str(root), "PI_CODING_AGENT_DIR": str(home / ".pi/agent"),
            "PI_OFFLINE": "1"}
        stage = "installed_openconnector"
        # Retain the published workflow's installed catalog check.
        if subprocess.run(["dpkg", "--compare-versions", version, "ge", "0.3.38"]).returncode == 0:
            with (root / "openconnector.log").open("w") as output:
                process = subprocess.Popen([str(node), str(desktop / "scripts/test-staged-openconnector.mjs")],
                    env={**environment, "EDUPI_STAGED_RESOURCES": str(resources)},
                    stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                check(process.wait(timeout=90) == 0, "installed_openconnector_failed")
            stop_application(process)
            process = None
        evidence["launches"] = []
        storage = []
        for label in ["first", "restart"]:
            stage = label + "_launch"
            with (root / (label + "-app.log")).open("w") as output:
                process = subprocess.Popen(["xvfb-run", "--auto-servernum",
                    "--server-args=-screen 0 1280x900x24", str(binary)], env=environment,
                    stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                previous_instance = evidence["launches"][-1]["instanceId"] if evidence["launches"] else None
                evidence["launches"].append(wait_for_core(process, config, root, label, pin, previous_instance))
                stop_application(process)
                process = None
            stage = label + "_storage"
            storage.append(read_storage(data))
        check(storage[0] == storage[1], "core_database_changed_across_restart")
        check(evidence["launches"][0]["instanceId"] != evidence["launches"][1]["instanceId"],
              "desktop_instance_unchanged_across_restart")
        evidence["freshInstanceAfterRestart"] = True
        evidence["storage"] = {"readOnlyChecks": storage, "sameDatabaseAfterRestart": True}
        evidence["status"] = "passed"
        result = 0
    except BaseException as error:
        # Keep original errors and logs private. CI receives only the stage and
        # error type, never exception text, response bodies or process arguments.
        (root / "failure.log").write_text(traceback.format_exc(), encoding="utf-8")
        evidence["failure"] = {"stage": stage, "type": type(error).__name__}
        if isinstance(error, InstallFailure):
            evidence["failure"]["code"] = str(error)
        if isinstance(error, subprocess.CalledProcessError):
            evidence["failure"]["exitCode"] = error.returncode
    finally:
        try:
            stop_application(process)
        except BaseException:
            evidence["status"] = "failed"
            evidence["cleanupFailure"] = {"stage": "process_cleanup", "type": "RuntimeError"}
            result = 1
            with (root / "failure.log").open("a") as output:
                output.write(traceback.format_exc())
        evidence_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        # Only this allowlisted evidence file is uploaded; private diagnostics
        # remain in the isolated runner directory on failure.
        print(json.dumps(evidence, indent=2))
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
                output.write("\nLinux Debian install and Core startup\n```json\n"
                             + json.dumps(evidence, indent=2) + "\n```\n")
        if result == 0:
            for item in root.iterdir():
                if item != evidence_path:
                    shutil.rmtree(item) if item.is_dir() else item.unlink()
    return result


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    sys.exit(main(Path(sys.argv[1]).resolve()))
PY_LINUX_INSTALL
