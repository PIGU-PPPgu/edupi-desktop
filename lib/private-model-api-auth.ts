import { DESKTOP_API_TOKEN_ENV } from "./desktop-api";
import { isDesktopApiRequestAllowed } from "./desktop-api-auth";
import { isApiRequestAllowed } from "./request-security";

/** Keep credential and model-spending APIs inside the desktop shell in packaged builds. */
export function isPrivateModelApiRequestAllowed(request: Request): boolean {
  const token = process.env[DESKTOP_API_TOKEN_ENV];
  if (token !== undefined) return isDesktopApiRequestAllowed(request, token);
  // Only the repository's loopback launcher opts in. LAN launchers clear this
  // flag, since Host and Origin can be forged by non-browser LAN clients.
  if (process.env.PI_WEB_PRIVATE_MODEL_LOCAL !== "1") return false;
  if (!isApiRequestAllowed(request)) return false;
  // The browser development server has no native token. It can configure
  // models only through its loopback origin, never through a LAN address.
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const requestHostname = new URL(request.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return [hostname, requestHostname].every((value) => value === "localhost" || value === "127.0.0.1" || value === "::1");
  } catch {
    return false;
  }
}
