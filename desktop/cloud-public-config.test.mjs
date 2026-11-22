import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { publicCloudConfig, loadPackagedPublicCloudConfig } = createRequire(import.meta.url)("./cloud-public-config.cjs");
const key = role => `synthetic.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.synthetic`;
test("packaged launch loads only public config and leaves local mode as default", () => {
  const root = mkdtempSync(join(tmpdir(), "edupi-public-config-"));
  try {
    const file = join(root, "cloud.json");
    const expected = publicCloudConfig({ SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: key("anon") });
    writeFileSync(file, JSON.stringify(expected));
    const environment = {};
    assert.equal(loadPackagedPublicCloudConfig(file, environment), true);
    assert.equal(environment.SUPABASE_ANON_KEY, key("anon"));
    assert.equal(environment.EDUPI_DATA_MODE, undefined);
    environment.SUPABASE_URL = "https://override.invalid";
    loadPackagedPublicCloudConfig(file, environment);
    assert.equal(environment.SUPABASE_URL, "https://override.invalid");
    assert.throws(() => publicCloudConfig({ SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: key("service_role") }));
    assert.throws(() => publicCloudConfig({ SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: "sb_secret_synthetic" }));
    assert.throws(() => publicCloudConfig({ SUPABASE_URL: "http://example.invalid", SUPABASE_ANON_KEY: key("anon") }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
