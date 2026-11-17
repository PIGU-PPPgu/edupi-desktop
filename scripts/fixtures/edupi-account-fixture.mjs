// Synthetic loopback server for contract and UI verification only.
// Never imported by the application and never enabled as a login fallback.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const contract = "edupi-account-v1";
const secret = () => randomBytes(32).toString("base64url");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4XcAAAAASUVORK5CYII=";
const identity = kind => ({ kind, namespace: kind === "wechat_miniprogram" ? "synthetic-mini-app" : "synthetic-verifier",
  subject: `synthetic-${kind}-subject`, label: { wechat_miniprogram: "验收微信", phone: "138****0000", email: "t***@example.test" }[kind],
  verified_at: "2026-11-16T00:00:00.000Z" });

export async function createAccountFixture() {
  const challenges = new Map(), tokens = new Map(), exchanges = new Map();
  const profile = { account_id: "synthetic-teacher-1", display_name: "扫码验收教师", identities: [identity("wechat_miniprogram")] };
  const counters = { create: 0, poll: 0, exchange: 0, refresh: 0, revoke: 0, me: 0 };
  let failNext = null;
  const reply = (res, body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ contract, ...body })); };
  const issue = () => {
    const access_token = secret(), refresh_token = secret();
    tokens.set(access_token, true); tokens.set(refresh_token, true);
    return { token_type: "Bearer", access_token, refresh_token, expires_in: 60 };
  };
  const authorize = (id, options = {}) => {
    const challenge = challenges.get(id);
    if (!challenge) throw new Error("Synthetic challenge not found");
    challenge.status = "authorized";
    const kind = { bind_phone: "phone", bind_email: "email", bind_wechat: "wechat_miniprogram" }[challenge.purpose];
    if (kind && !profile.identities.some(item => item.kind === kind)) profile.identities.push(identity(kind));
    challenge.wrongAccount = options.wrongAccount || false;
    challenge.missingIdentity = options.missingIdentity || false;
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/__test/state") {
        return reply(res, { challenges: [...challenges.values()].map(({ id, status, purpose }) => ({ id, status, purpose })), counters, profile });
      }
      let bytes = 0, content = "";
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) return reply(res, {}, 413); content += chunk; }
      const input = content ? JSON.parse(content) : {};
      if (url.pathname === "/__test/control") {
        const challenge = input.id || [...challenges.keys()].at(-1);
        if (input.action === "authorize") authorize(challenge, input);
        else if (input.action === "fail_next") failNext = input.path;
        else if (challenges.has(challenge)) challenges.get(challenge).status = input.action;
        return reply(res, { ok: true });
      }
      if (req.method !== "GET" && input.contract !== contract) return reply(res, {}, 400);
      if (failNext === url.pathname) { failNext = null; return reply(res, {}, 503); }
      const bearer = req.headers.authorization?.replace(/^Bearer /u, "");
      if (url.pathname === "/v1/desktop/challenges") {
        if (input.purpose !== "login" && !tokens.has(bearer)) return reply(res, {}, 401);
        counters.create++;
        const id = `synthetic-${counters.create}`, device = secret(), code = secret();
        challenges.set(id, { id, device, code, purpose: input.purpose, pkce: input.code_challenge, status: "pending" });
        return reply(res, { challenge_id: id, device_code: device, user_code: `TEST-${counters.create}`,
          expires_in: 60, interval: 5, qr_png_base64: png });
      }
      const match = url.pathname.match(/^\/v1\/desktop\/challenges\/([^/]+)\/(poll|cancel)$/u);
      if (match) {
        const challenge = challenges.get(match[1]);
        if (!challenge || input.device_code !== challenge.device) return reply(res, {}, 403);
        if (match[2] === "cancel") { challenge.status = "denied"; return reply(res, { ok: true }); }
        counters.poll++;
        return reply(res, { challenge_id: challenge.id, status: challenge.status,
          ...(challenge.status === "authorized" ? { authorization_code: challenge.code } : {}) });
      }
      if (url.pathname === "/v1/desktop/token") {
        const key = req.headers["idempotency-key"];
        if (!key) return reply(res, {}, 400);
        if (input.grant_type === "refresh_token") {
          counters.refresh++;
          if (!tokens.has(input.refresh_token)) return reply(res, {}, 401);
          if (!exchanges.has(key)) exchanges.set(key, issue());
          return reply(res, exchanges.get(key));
        }
        const challenge = challenges.get(input.challenge_id);
        if (!challenge || input.authorization_code !== challenge.code || challenge.status !== "authorized"
          || createHash("sha256").update(input.code_verifier || "").digest("base64url") !== challenge.pkce) return reply(res, {}, 403);
        counters.exchange++;
        if (!exchanges.has(key)) exchanges.set(key, issue());
        const token = exchanges.get(key);
        tokens.set(token.access_token, { wrongAccount: challenge.wrongAccount, missingIdentity: challenge.missingIdentity });
        return reply(res, token);
      }
      if (url.pathname === "/v1/me") {
        counters.me++;
        if (!tokens.has(bearer)) return reply(res, {}, 401);
        const options = tokens.get(bearer);
        return reply(res, { account: { ...profile, ...(options?.wrongAccount ? { account_id: "synthetic-other-teacher" } : {}),
          ...(options?.missingIdentity ? { identities: [identity("wechat_miniprogram")] } : {}) } });
      }
      if (url.pathname === "/v1/desktop/revoke") {
        counters.revoke++; tokens.delete(input.token); tokens.delete(bearer); return reply(res, { ok: true });
      }
      return reply(res, {}, 404);
    } catch { reply(res, {}, 500); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, counters, challenges, profile, authorize,
    fail: endpoint => { failNext = endpoint; }, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await createAccountFixture();
  console.log(JSON.stringify({ synthetic: true, origin: fixture.origin, qr: "one-pixel placeholder; not a working WeChat QR" }));
}
