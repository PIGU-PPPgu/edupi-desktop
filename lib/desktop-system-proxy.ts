import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// EnvHttpProxyAgent consumes HTTP(S)_PROXY; ALL_PROXY alone is not effective.
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
const LOOPBACK_BYPASS = "localhost,127.0.0.1,::1,[::1]";

export type DesktopSystemProxy = { httpProxy?: string; httpsProxy?: string; noProxy: string };

/** Read the explicit local HTTP proxies already configured in macOS. */
export function parseMacSystemProxy(output: string, noProxy = ""): DesktopSystemProxy | undefined {
  function value(name: string): string | undefined {
    return output.match(new RegExp("^\\s*" + name + "\\s*:\\s*(\\S+)\\s*$", "mu"))?.[1];
  }
  function proxy(kind: "HTTP" | "HTTPS"): string | undefined {
    if (value(kind + "Enable") !== "1") return undefined;
    const host = value(kind + "Proxy");
    const rawPort = value(kind + "Port");
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return undefined;
    if (!rawPort || !/^\d{1,5}$/u.test(rawPort)) return undefined;
    const port = Number(rawPort);
    if (port < 1 || port > 65_535) return undefined;
    return `http://${host === "::1" ? "[::1]" : host}:${port}`;
  }
  const httpProxy = proxy("HTTP");
  const httpsProxy = proxy("HTTPS");
  if (!httpProxy && !httpsProxy) return undefined;
  // Keep Core, desktop APIs and local model endpoints off the proxy.
  return { httpProxy, httpsProxy, noProxy: [LOOPBACK_BYPASS, noProxy].filter(Boolean).join(",") };
}

export async function readDesktopSystemProxy({
  platform = process.platform,
  env = process.env,
  read = async () => (await execFileAsync("/usr/sbin/scutil", ["--proxy"], {
    timeout: 1_000, maxBuffer: 16_384, encoding: "utf8", windowsHide: true,
  })).stdout,
}: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  read?: () => Promise<string>;
} = {}): Promise<DesktopSystemProxy | undefined> {
  if (platform !== "darwin" || !env.PI_DESKTOP_STATE_DIR || PROXY_ENV_KEYS.some((key) => env[key])) return undefined;
  try {
    return parseMacSystemProxy(await read(), env.no_proxy || env.NO_PROXY);
  } catch {
    return undefined;
  }
}
