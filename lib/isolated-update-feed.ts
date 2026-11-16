import {
  compareAppVersions,
  getUnknownAppReleaseInfo,
  type AppUpdateProject,
} from "./app-updates";
import type { AppComponentReleaseInfo } from "./app-update-types";

export const ISOLATED_UPDATE_FEED_ENV = "EDUPI_ISOLATED_UPDATE_FEED";
const FEED_PATH = /^\/PIGU-PPPgu\/edupi-desktop\/[a-f0-9]{40}\/docs\/acceptance\/update-cohorts\/[a-z0-9][a-z0-9-]{0,63}\.json$/;

/** Mirrors the native validator; a commit URL makes each acceptance cohort immutable. */
export function validateIsolatedUpdateFeed(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("隔离更新地址无效"); }
  if (
    url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com"
    || url.port || url.username || url.password || url.search || url.hash
    || !FEED_PATH.test(url.pathname) || url.href !== value
  ) throw new Error("隔离更新地址无效");
  return url.href;
}

export function isolatedUpdateFeedFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[ISOLATED_UPDATE_FEED_ENV];
  if (value === undefined) return null;
  // This child flag is set by the native root validator, not by a URL/query parameter.
  if (env.EDUPI_DESKTOP_ISOLATED_CANARY !== "1") throw new Error("隔离更新需要独立验收资料目录");
  return validateIsolatedUpdateFeed(value);
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function getIsolatedAppRelease(
  project: AppUpdateProject,
  feed: string,
  fetcher: Fetcher = fetch,
): Promise<AppComponentReleaseInfo> {
  const response = await fetcher(validateIsolatedUpdateFeed(feed), {
    method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`隔离更新清单请求失败：HTTP ${response.status}`);
  const manifest: unknown = await response.json().catch(() => { throw new Error("隔离更新清单无效"); });
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("隔离更新清单无效");
  const version = (manifest as Record<string, unknown>).version;
  if (typeof version !== "string" || !/^0\.3\.(0|[1-9]\d*)$/.test(version)) throw new Error("隔离更新版本无效");
  return {
    ...getUnknownAppReleaseInfo(project),
    latestVersion: version,
    releaseUrl: `https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v${version}`,
    updateAvailable: compareAppVersions(version, project.currentVersion) > 0,
    releaseStatus: "available",
  };
}
