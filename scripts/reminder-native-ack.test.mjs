import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows notification command waits for Toast.show outcome before acknowledging delivery", async () => {
  const source = await readFile("src-tauri/src/reminder_notification.rs", "utf8");
  const command = source.slice(source.indexOf("fn send_reminder_notification_blocking("), source.indexOf("#[cfg(test)]", source.indexOf("fn send_reminder_notification_blocking(")));
  assert.match(command, /#\[cfg\(target_os = "windows"\)\][\s\S]*?receiver\s*\.recv_timeout/u);
  assert.match(command, /sender\.send\(result\)/u);
  assert.match(command, /#\[cfg\(target_os = "linux"\)\]/u);
});

test("native reminder proof and OS submission run outside Tauri's UI thread", async () => {
  const source = await readFile("src-tauri/src/reminder_notification.rs", "utf8");
  assert.match(source, /pub async fn send_reminder_notification\([\s\S]*?tauri::async_runtime::spawn_blocking\(move \|\| send_reminder_notification_blocking\(app, request\)\)/u);
  assert.match(source, /\.map_err\(\|_\| "notification_send_unknown"\.to_string\(\)\)\?/u);
});

test("Windows and Linux acknowledgement waits outlast the final Core source proof", async () => {
  const [sender, gate] = await Promise.all([
    readFile("src-tauri/src/reminder_notification.rs", "utf8"),
    readFile("src-tauri/src/reminder_notification_gate.rs", "utf8"),
  ]);
  const proofMs = Number(gate.match(/const DEADLINE: Duration = Duration::from_millis\((\d+)\)/u)?.[1]);
  const acknowledgementMs = Number(sender.match(/NATIVE_SEND_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs\((\d+)\)/u)?.[1]) * 1000;
  assert.ok(acknowledgementMs > proofMs + 2_000);
  assert.equal(sender.match(/recv_timeout\(NATIVE_SEND_ACK_TIMEOUT\)/gu)?.length, 2);
});

test("native reminder clicks can be drained by the trusted main WebView after cold start", async () => {
  const rust = await readFile("src-tauri/src/reminder_notification.rs", "utf8");
  const library = await readFile("src-tauri/src/lib.rs", "utf8");
  const permissions = await readFile("src-tauri/permissions/desktop-shell.toml", "utf8");
  const capability = await readFile("src-tauri/capabilities/desktop-dialog.json", "utf8");
  assert.match(rust, /pub fn take_pending_reminder_open\(\)/u);
  assert.match(rust, /set_persisted_target_user_info/u);
  assert.match(library, /reminder_notification::take_pending_reminder_open/u);
  assert.match(permissions, /commands\.allow = \["take_pending_reminder_open"\]/u);
  assert.match(capability, /"allow-take-pending-reminder-open"/u);
});
