"use strict";
const fs = require("node:fs"); // eslint-disable-line @typescript-eslint/no-require-imports

function publicCloudConfig(environment) {
  const key = environment.SUPABASE_ANON_KEY || environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  const url = new URL(environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid public cloud URL");
  let role;
  try { role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch { /* Publishable keys have no JWT. */ }
  if (role !== "anon" && !key.startsWith("sb_publishable_")) throw new Error("Only a Supabase public key may be packaged");
  return { version: 1, url: url.href.replace(/\/+$/u, ""), anonKey: key };
}

function loadPackagedPublicCloudConfig(file, environment = process.env) {
  let source;
  try { source = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return false; throw new Error("Invalid packaged public cloud configuration"); }
  if (!source) return false;
  if (source.version !== 1 || Object.keys(source).some(key => !["version", "url", "anonKey"].includes(key)))
    throw new Error("Invalid packaged public cloud configuration");
  const config = publicCloudConfig({ SUPABASE_URL: source.url, SUPABASE_ANON_KEY: source.anonKey });
  if (!config) throw new Error("Missing packaged public cloud key");
  environment.SUPABASE_URL ||= config.url;
  environment.SUPABASE_ANON_KEY ||= config.anonKey;
  return true;
}
module.exports = { publicCloudConfig, loadPackagedPublicCloudConfig };
