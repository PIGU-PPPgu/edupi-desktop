export const MAX_PRIVATE_MODEL_CONFIG_BYTES = 32_768;
export const G1_MODEL_MAX_CALLS = 12;
export const G1_MODEL_TIMEOUT_MS = 300_000;
export const RECALL_MODEL_MAX_CALLS = 64;
// Leave time for authenticated source revalidation inside the 15-second owner request.
export const RECALL_MODEL_TIMEOUT_MS = 12_000;
export const ISOLATED_MODEL_APIS = Object.freeze(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]);

export const modelConfigurationError = () => Object.assign(new Error("Model configuration unavailable."), { code: "model_unavailable" });
const plain = value => value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function privateDataKeys(value, keys) {
  return plain(value) && Reflect.ownKeys(value).every(key => {
    const descriptor = typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : null;
    return keys.includes(key) && descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}
export function boundedPrivateData(value, maxBytes) {
  let nodes = 0, stringBytes = 0;
  const walk = (item, depth) => {
    if (depth > 12 || ++nodes > 4096) return false;
    if (typeof item === "string") { stringBytes += Buffer.byteLength(item); return stringBytes <= maxBytes; }
    if (item == null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.length <= 1024 && item.every(child => walk(child, depth + 1));
    return plain(item) && Reflect.ownKeys(item).length <= 256 && Reflect.ownKeys(item).every(key => {
      const descriptor = typeof key === "string" ? Object.getOwnPropertyDescriptor(item, key) : null;
      return descriptor?.enumerable && Object.hasOwn(descriptor, "value") && walk(descriptor.value, depth + 1);
    });
  };
  try { return walk(value, 0) && Buffer.byteLength(JSON.stringify(value)) <= maxBytes; } catch { return false; }
}

/** Only the parent-selected configuration may cross private IPC. No caller budgets. */
export function validatePrivateModelConfiguration(value) {
  if (!privateDataKeys(value, ["model", "apiKey", "maxTokens", "allowLoopback"])
    || Object.keys(value).length !== 4 || !boundedPrivateData(value, MAX_PRIVATE_MODEL_CONFIG_BYTES)
    || !plain(value.model) || !boundedPrivateData(value.model, 16_384)
    || typeof value.apiKey !== "string" || !value.apiKey || value.apiKey.length > 8192 || /[\r\n]/u.test(value.apiKey)
    || !Number.isSafeInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 8192
    || typeof value.allowLoopback !== "boolean") throw modelConfigurationError();
  const model = value.model;
  if (!["id", "provider", "name"].every(key => typeof model[key] === "string" && model[key].length > 0 && model[key].length <= 512)
    || !ISOLATED_MODEL_APIS.includes(model.api)
    || model.type !== undefined && model.type !== "chat"
    || typeof model.reasoning !== "boolean" || !Array.isArray(model.input) || !model.input.includes("text")
    || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1
    || !Number.isSafeInteger(model.maxTokens) || model.maxTokens < value.maxTokens
    || model.headers != null && (!plain(model.headers) || Object.keys(model.headers).length)) throw modelConfigurationError();
  let endpoint;
  try { endpoint = new URL(model.baseUrl); } catch { throw modelConfigurationError(); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.protocol !== "https:" && !(value.allowLoopback && endpoint.protocol === "http:"
      && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname))) throw modelConfigurationError();
  return structuredClone(value);
}

/** Recall activation needs a complete Live profile, not just a usable endpoint. */
export function validatePrivateRecallModelConfiguration(value, { allowLoopback = false } = {}) {
  const configuration = validatePrivateModelConfiguration(value);
  const { model, apiKey } = configuration;
  const text = (item, maximum) => typeof item === "string" && item.length > 0 && item.length <= maximum
    && item.trim() === item && !/[\u0000-\u001f\u007f]/u.test(item);
  if (!["id", "name", "provider"].every(key => text(model[key], 256)) || !text(apiKey, 8192)
    || !text(model.baseUrl, 2048) || model.input.length !== 1 || model.input[0] !== "text"
    || model.contextWindow > 100_000_000 || model.maxTokens > model.contextWindow
    || !privateDataKeys(model.cost, ["input", "output", "cacheRead", "cacheWrite"])
    || Object.keys(model.cost).length !== 4
    || Object.values(model.cost).some(cost => typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) {
    throw modelConfigurationError();
  }
  const endpoint = new URL(model.baseUrl);
  if (configuration.allowLoopback && allowLoopback !== true
    || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname) && configuration.allowLoopback !== true) {
    throw modelConfigurationError();
  }
  return configuration;
}
