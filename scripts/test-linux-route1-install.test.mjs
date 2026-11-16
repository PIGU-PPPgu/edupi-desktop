import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./test-linux-route1-install.sh", import.meta.url), "utf8");
const python = source.match(/<<'PY_LINUX_INSTALL'\n([\s\S]*?)\nPY_LINUX_INSTALL/)[1];

function runPython(body) {
  // Exercise the actual embedded helpers without installing a package or
  // pretending this macOS host has run the Linux application.
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", `
import json, sys
request = json.load(sys.stdin)
context = {"__name__": "linux_install_test"}
exec(compile(request["source"], "linux-install-helper", "exec"), context)
exec(compile(request["test"], "linux-install-test", "exec"), context)
`], { input: JSON.stringify({ source: python, test: body }), encoding: "utf8", timeout: 20_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test("Linux install uses private paths, a clean environment and two native app launches", () => {
  assert.match(source, /sys\.platform == "linux"/u);
  assert.match(source, /os\.umask\(0o077\)/u);
  assert.match(source, /tempfile\.mkdtemp\(prefix="edupi-linux-install-"/u);
  assert.match(source, /"dpkg-deb", "-f"/u);
  assert.match(source, /version == expected and architecture == "amd64"/u);
  assert.match(source, /"sudo", "apt-get", "install", "--yes", str\(deb\)/u);
  assert.match(source, /"dpkg-query", "-W"/u);
  assert.match(source, /"HOME": str\(home\)/u);
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
    "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "PI_CODING_AGENT_DIR", "PI_OFFLINE"]) {
    assert.ok(source.includes(`"${key}":`));
  }
  assert.doesNotMatch(source, /os\.environ\.copy\(\)|env=os\.environ|pkill|pgrep -af/u);
  assert.match(source, /for label in \["first", "restart"\]/u);
  assert.match(source, /"xvfb-run", "--auto-servernum"/u);
  assert.match(source, /api\/desktop\/identity/u);
  assert.match(source, /api\/edupi\/status\?summary=1/u);
  assert.match(source, /teacher_workflow_not_exercised/u);
  assert.match(source, /updater_not_exercised/u);
});

test("both installed manifests must match their canonical bytes and the compatibility pins", () => {
  runPython(`
with tempfile.TemporaryDirectory() as directory:
    resources = Path(directory)
    contracts = resources / "edupi-core/contracts"
    contracts.mkdir(parents=True)
    pin = {"core_commit": "a" * 40,
           "component_manifest_path": "contracts/edupi-desktop-component-manifest.json",
           "runtime_schema_hash": "sha256:" + "b" * 64}
    names = [("edupi-desktop-component-manifest.json", "component_manifest_hash"),
             ("edupi-core-runtime-component-manifest.json", "runtime_component_manifest_hash")]
    for name, field in names:
        payload = {"modules": [], "entrypoint": name, "assets": []}
        digest = "sha256:" + hashlib.sha256(json.dumps(payload, sort_keys=True,
            separators=(",", ":")).encode()).hexdigest()
        pin[field] = digest
        (contracts / name).write_text(json.dumps({**payload, "component_manifest_hash": digest}))
    (contracts / "edupi-core-runtime-v1-hash.json").write_text(json.dumps({"schema_hash": pin["runtime_schema_hash"]}))
    assert verify_manifests(resources, {"core_runtime": pin}) == pin
    for name, field in names:
        path = contracts / name
        original = path.read_text()
        payload = json.loads(original)
        payload["entrypoint"] = "tampered"
        path.write_text(json.dumps(payload))
        try:
            verify_manifests(resources, {"core_runtime": pin})
        except RuntimeError as error:
            assert str(error) == field + "_mismatch"
        else:
            raise AssertionError("tampered manifest accepted")
        path.write_text(original)
        wrong = {**pin, field: "sha256:" + "0" * 64}
        try:
            verify_manifests(resources, {"core_runtime": wrong})
        except RuntimeError:
            pass
        else:
            raise AssertionError("wrong compatibility pin accepted")
    (contracts / "edupi-core-runtime-v1-hash.json").write_text('{"schema_hash":"wrong"}')
    try:
        verify_manifests(resources, {"core_runtime": pin})
    except RuntimeError as error:
        assert str(error) == "runtime_schema_hash_mismatch"
    else:
        raise AssertionError("wrong schema pin accepted")
`);
});

test("Core readiness rejects a mismatched running identity, external Core, and enabled sending", () => {
  runPython(`
import copy
pin = {"core_commit": "a" * 40, "component_manifest_hash": "sha256:" + "b" * 64,
       "runtime_component_manifest_hash": "sha256:" + "c" * 64}
identity = {"coreCommit": pin["core_commit"], "componentManifestHash": pin["component_manifest_hash"],
            "runtimeComponentManifestHash": pin["runtime_component_manifest_hash"]}
ready = {"core": {**identity, "status": "ready", "validationMode": "bundled"},
         "projection": {"status": "ready"}, "externalSend": False,
         "compatibility": {"expected": identity, "actual": identity}}
verify_status(ready, pin)
for section in ["core", "expected", "actual"]:
    for field in identity:
        bad = copy.deepcopy(ready)
        target = bad["core"] if section == "core" else bad["compatibility"][section]
        target[field] = "wrong"
        try:
            verify_status(bad, pin)
        except RuntimeError as error:
            assert str(error) == "running_core_pin_mismatch"
        else:
            raise AssertionError("wrong running identity accepted")
for section, key, value in [("core", "validationMode", "external"),
                            ("core", "status", "unavailable"),
                            ("projection", "status", "unavailable"), (None, "externalSend", True)]:
    bad = copy.deepcopy(ready)
    target = bad if section is None else bad[section]
    target[key] = value
    try:
        verify_status(bad, pin)
    except RuntimeError:
        pass
    else:
        raise AssertionError("unsafe or unavailable Core accepted")
`);
});

test("storage evidence reads a real persisted SQLite file without modifying it", () => {
  runPython(`
with tempfile.TemporaryDirectory() as directory:
    data = Path(directory)
    database = data / ".edupi/runtime/core-runtime-v1.sqlite"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE acceptance (value TEXT)")
        connection.execute("INSERT INTO acceptance VALUES ('isolated fixture')")
    before = database.read_bytes()
    first = read_storage(data)
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        assert connection.execute("SELECT value FROM acceptance").fetchone()[0] == "isolated fixture"
    assert first == read_storage(data)
    assert first["quickCheck"] == "ok" and first["tables"] == ["acceptance"]
    assert database.read_bytes() == before
    database.write_bytes(b"invalid SQLite")
    try:
        read_storage(data)
    except sqlite3.DatabaseError:
        pass
    else:
        raise AssertionError("corrupt database accepted")
`);
});

for (const separateGroup of [false, true]) test(`cleanup stops the launch and its ${separateGroup ? "independent" : "shared"} child process group without touching another session`,
  { skip: process.platform === "win32" }, () => {
  runPython(`
unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
process = None
try:
    process = subprocess.Popen([sys.executable, "-c",
        "import os,subprocess,sys,time; child=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], preexec_fn=${separateGroup ? "os.setpgrp" : "None"}); print(child.pid, flush=True); time.sleep(60)"],
        start_new_session=True, stdout=subprocess.PIPE, text=True)
    child_pid = int(process.stdout.readline())
    assert child_pid in [pid for pid, _ in live_session(process.pid)]
    if ${separateGroup ? "True" : "False"}:
        assert os.getpgid(child_pid) != process.pid
    stop_application(process)
    assert process.poll() is not None and live_session(process.pid) == []
    assert unrelated.poll() is None
finally:
    stop_application(process)
    stop_application(unrelated)
`);
});

test("restart readiness skips an old instance response before reading the new Core status", () => {
  runPython(`
import io
from unittest.mock import patch
pin = {"core_commit": "a" * 40, "component_manifest_hash": "sha256:" + "b" * 64,
       "runtime_component_manifest_hash": "sha256:" + "c" * 64}
identity = {"coreCommit": pin["core_commit"], "componentManifestHash": pin["component_manifest_hash"],
            "runtimeComponentManifestHash": pin["runtime_component_manifest_hash"]}
ready = {"core": {**identity, "status": "ready", "validationMode": "bundled"},
         "projection": {"status": "ready"}, "externalSend": False,
         "compatibility": {"expected": identity, "actual": identity}}
class Reply(io.BytesIO):
    status = 204
    def __init__(self, instance):
        super().__init__(json.dumps(ready).encode())
        self.headers = {"x-pi-desktop-instance": instance}
class Running:
    pid = 12345
    def poll(self): return None
instances = iter(["a" * 64, "b" * 64])
calls = []
def response(url, **kwargs):
    calls.append(url)
    return Reply(next(instances) if url.endswith("/identity") else "b" * 64)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / "ui-prefs.json").write_text('{"serverPort":38471}')
    with patch.object(urllib.request, "urlopen", side_effect=response), patch.object(time, "sleep"):
        result = wait_for_core(Running(), root, root, "restart", pin, "a" * 64)
    assert result["instanceId"] == "b" * 64
    assert calls == ["http://127.0.0.1:38471/api/desktop/identity",
                     "http://127.0.0.1:38471/api/desktop/identity",
                     "http://127.0.0.1:38471/api/edupi/status?summary=1"]
`);
});

test("failed package checks retain the original error privately and do not attempt installation", () => {
  runPython(`
import contextlib
import io
from unittest.mock import patch
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    deb = root / "fixture.deb"
    deb.write_bytes(b"isolated deb metadata fixture")
    output = io.StringIO()
    environment = {"RUNNER_TEMP": str(root), "EDUPI_DEB": str(deb), "EDUPI_TEST_RELEASE": "v1.2.3",
                   "PATH": os.environ["PATH"], "GITHUB_ENV": str(root / "github-env")}
    with patch.dict(os.environ, environment, clear=True), patch.object(sys, "platform", "linux"), \\
         patch.object(subprocess, "check_output", side_effect=RuntimeError("api_key=private-error-fixture")), \\
         patch.object(subprocess, "run") as install, contextlib.redirect_stdout(output):
        assert main(root) == 1
        install.assert_not_called()
    private = next(root.glob("edupi-linux-install-*"))
    assert "private-error-fixture" in (private / "failure.log").read_text()
    assert "private-error-fixture" not in output.getvalue()
    assert "private-error-fixture" not in (private / "evidence.json").read_text()
    assert read_json(private / "evidence.json")["failure"]["stage"] == "package_identity"
    if os.name != "nt":
        assert private.stat().st_mode & 0o077 == 0
`);
});

test("a wrong Debian version or architecture is rejected before apt runs", () => {
  runPython(`
import contextlib
import io
from unittest.mock import patch
for version, architecture in [("1.2.2", "amd64"), ("1.2.3", "arm64")]:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        deb = root / "fixture.deb"
        deb.write_bytes(b"isolated deb metadata fixture")
        environment = {"RUNNER_TEMP": str(root), "EDUPI_DEB": str(deb),
                       "EDUPI_TEST_RELEASE": "v1.2.3", "PATH": os.environ["PATH"]}
        with patch.dict(os.environ, environment, clear=True), patch.object(sys, "platform", "linux"), \\
             patch.object(subprocess, "check_output", side_effect=["edupi", version, architecture]), \\
             patch.object(subprocess, "run") as install, contextlib.redirect_stdout(io.StringIO()):
            assert main(root) == 1
            install.assert_not_called()
        private = next(root.glob("edupi-linux-install-*"))
        assert "debian_package_identity_mismatch" in (private / "failure.log").read_text()
        assert read_json(private / "evidence.json")["failure"]["code"] == "debian_package_identity_mismatch"
`);
});
