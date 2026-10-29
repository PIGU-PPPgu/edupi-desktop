import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { isPrivateModelApiRequestAllowed } = await createJiti(import.meta.url).import("./private-model-api-auth.ts");
const token = "synthetic-private-model-token-12345678901234567890";
const request = (host, headers = {}) => new Request(`http://${host}/api/models-config`, { headers: { host, ...headers } });

test("packaged model configuration requires the desktop token and loopback Host", () => {
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = token;
  try {
    assert.equal(isPrivateModelApiRequestAllowed(request("127.0.0.1:30141", { "x-pi-desktop-token": token })), true);
    assert.equal(isPrivateModelApiRequestAllowed(request("127.0.0.1:30141")), false);
    assert.equal(isPrivateModelApiRequestAllowed(request("192.168.1.10:30141", { "x-pi-desktop-token": token })), false);
    assert.equal(isPrivateModelApiRequestAllowed(request("127.0.0.1:30141", { origin: "https://attacker.invalid", "x-pi-desktop-token": token })), false);
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previous;
  }
});

test("browser development configuration stays on the local origin", () => {
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  const previousLocal = process.env.PI_WEB_PRIVATE_MODEL_LOCAL;
  delete process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_WEB_PRIVATE_MODEL_LOCAL = "1";
  try {
    assert.equal(isPrivateModelApiRequestAllowed(request("localhost:30141", { origin: "http://localhost:30141" })), true);
    assert.equal(isPrivateModelApiRequestAllowed(request("192.168.1.10:30141")), false);
    assert.equal(isPrivateModelApiRequestAllowed(new Request("http://192.168.1.10:30141/api/models-config", { headers: { host: "localhost:30141" } })), false);
    assert.equal(isPrivateModelApiRequestAllowed(request("localhost:30141", { origin: "https://attacker.invalid" })), false);
    delete process.env.PI_WEB_PRIVATE_MODEL_LOCAL;
    assert.equal(isPrivateModelApiRequestAllowed(request("localhost:30141")), false);
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previous;
    if (previousLocal === undefined) delete process.env.PI_WEB_PRIVATE_MODEL_LOCAL;
    else process.env.PI_WEB_PRIVATE_MODEL_LOCAL = previousLocal;
  }
});
