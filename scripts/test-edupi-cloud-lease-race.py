"""Run on the existing Supabase host via SSH stdin; remove all UUID fixtures."""
import json
import subprocess
import uuid

container = "supabase_db_edupi-desktop"
command = ["docker", "exec", "-i", container, "psql", "-X", "-q", "-A", "-t",
           "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
workspace = str(uuid.uuid4())
actor = str(uuid.uuid4())
lease = "isolated-first-acquire-" + uuid.uuid4().hex
first = None


def sql(query):
    return subprocess.run(command, input=query, text=True, capture_output=True, timeout=20)


def transition(instance, action):
    body = json.dumps({
        "action": action, "instance_id": instance, "instance_nonce": instance + "-nonce",
        "core_commit": "isolated-security-regression", "fencing_generation": 1,
        "lease_name": lease, "ttl_seconds": 30,
    })
    return f"edupi.runtime_transition('{workspace}'::uuid,'{actor}'::uuid,'{body}'::jsonb)"


try:
    setup = sql(
        f"insert into auth.users(id) values('{actor}');"
        f"insert into edupi.workspaces(id,owner_account_id,mode) values('{workspace}','{actor}','cloud');"
        f"insert into edupi.workspace_members(workspace_id,account_id,role) values('{workspace}','{actor}','owner');"
        f"select ({transition('isolated-a', 'register')})->>'ok';"
        f"select ({transition('isolated-b', 'register')})->>'ok';"
    )
    if setup.returncode:
        raise RuntimeError("isolated lease fixture setup failed")
    first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
    first.stdin.write(
        "begin; set local lock_timeout='5s';"
        f"select ({transition('isolated-a', 'lease_acquire')})->>'ok';"
        "select pg_sleep(1); commit;\n"
    )
    first.stdin.close()
    if first.stdout.readline().strip() != "true" or first.poll() is not None:
        raise RuntimeError("first acquisition did not remain in its open transaction")
    # Connection B sees no committed lease row yet. It must wait for A, then
    # refuse the live owner instead of taking the ON CONFLICT overwrite path.
    second = sql(f"set lock_timeout='5s'; select ({transition('isolated-b', 'lease_acquire')})->>'ok';")
    first.wait(timeout=10)
    if first.returncode != 0 or second.returncode == 0 or "lease_held" not in second.stderr:
        raise RuntimeError("concurrent first acquisition did not preserve one owner")
    owner = sql(f"select instance_id from edupi.core_runtime_leases where workspace_id='{workspace}' and lease_name='{lease}';")
    if owner.returncode or owner.stdout.strip() != "isolated-a":
        raise RuntimeError("concurrent acquisition replaced the original owner")
    print("PASS two PostgreSQL connections: one first lease owner, competing acquire denied")
finally:
    if first and first.poll() is None:
        first.kill()
        first.wait(timeout=10)
    cleanup = sql(f"delete from edupi.workspaces where id='{workspace}'; delete from auth.users where id='{actor}';")
    if cleanup.returncode:
        raise RuntimeError("isolated lease fixture cleanup failed")
    print("PASS isolated lease accounts, workspace and leases removed")
