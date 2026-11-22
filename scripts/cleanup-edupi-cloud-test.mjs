import { execFileSync } from "node:child_process";

/** Cleanup stays on the server; its service role never enters a test client. */
export function cleanupCloudTest(userId, workspaceId) {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
  if (!uuid.test(userId || "") || workspaceId && !uuid.test(workspaceId)) throw new Error("invalid cleanup fixture identity");
  const script = `
set -euo pipefail
. /srv/edupi-supabase/.supabase.env
email="$(curl -fsS "$API_URL/auth/v1/admin/users/${userId}" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r .email)"
case "$email" in *@example.invalid) ;; *) echo "refusing non-test account cleanup" >&2; exit 1 ;; esac
${workspaceId ? `
owner="$(docker exec supabase_db_edupi-desktop psql -X -qAt -U postgres -d postgres -c "select owner_account_id from edupi.workspaces where id='${workspaceId}';")"
if [ -n "$owner" ]; then
  test "$owner" = "${userId}"
  names="$(docker exec supabase_db_edupi-desktop psql -X -qAt -U postgres -d postgres -c "select coalesce(json_agg(name),'[]'::json) from storage.objects where bucket_id='edupi-materials' and name like '${workspaceId}/%';")"
  if [ "$names" != "[]" ]; then
    printf '%s' "$names" | jq '{prefixes:.}' | curl -fsS -o /dev/null -X DELETE "$API_URL/storage/v1/object/edupi-materials" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "content-type: application/json" --data-binary @-
  fi
  docker exec supabase_db_edupi-desktop psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c "delete from edupi.workspaces where id='${workspaceId}';" >/dev/null
fi
` : ""}
curl -fsS -o /dev/null -X DELETE "$API_URL/auth/v1/admin/users/${userId}" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
`;
  execFileSync("ssh", ["-T", "-o", "BatchMode=yes", process.env.EDUPI_REMOTE_HOST || "ubuntu@43.134.4.108", "bash -s"],
    { input: script, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });
}
