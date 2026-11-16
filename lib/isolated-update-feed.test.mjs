import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { validateIsolatedUpdateFeed, isolatedUpdateFeedFromEnvironment, getIsolatedAppRelease } = await jiti.import("./isolated-update-feed.ts");
const { APP_UPDATE_PROJECTS } = await jiti.import("./app-updates.ts");
const feed = `https://raw.githubusercontent.com/PIGU-PPPgu/edupi-desktop/${"a".repeat(40)}/docs/acceptance/update-cohorts/macos-116-117.json`;

test("only an immutable first-party HTTPS cohort is accepted", () => {
  assert.equal(validateIsolatedUpdateFeed(feed), feed);
  for (const bad of [
    feed.replace("https:", "http:"), feed.replace("/" + "a".repeat(40) + "/", "/main/"),
    feed.replace("raw.githubusercontent.com", "example.com"),
    feed.replace("PIGU-PPPgu", "other"), `${feed}?token=secret`, `${feed}#fragment`,
    feed.replace("https://", "https://user@"), feed.replace(".com/", ".com:8443/"),
    feed.replace("/update-cohorts/", "/other/"),
    feed.replace("/docs/", "/ignored/../docs/"),
  ]) assert.throws(() => validateIsolatedUpdateFeed(bad), /隔离更新地址无效/);
});

test("normal sessions have no cohort and a supplied feed requires the native child admission flag", () => {
  assert.equal(isolatedUpdateFeedFromEnvironment({}), null);
  assert.equal(isolatedUpdateFeedFromEnvironment({ EDUPI_ISOLATED_UPDATE_FEED: feed, EDUPI_DESKTOP_ISOLATED_CANARY: "1" }), feed);
  for (const value of [undefined, "0", "true"]) {
    assert.throws(() => isolatedUpdateFeedFromEnvironment({ EDUPI_ISOLATED_UPDATE_FEED: feed, EDUPI_DESKTOP_ISOLATED_CANARY: value }), /独立验收资料目录/);
  }
});

test("the release display discovers a higher cohort version and stops offering the installed version", async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, method: init.method, authorization: new Headers(init.headers).has("authorization") });
    return Response.json({ version: "0.3.117" });
  };
  const project = { ...APP_UPDATE_PROJECTS[0], currentVersion: "0.3.116" };
  const release = await getIsolatedAppRelease(project, feed, fetcher);
  assert.equal(release.latestVersion, "0.3.117");
  assert.equal(release.updateAvailable, true);
  assert.equal(release.releaseUrl, "https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.117");
  assert.equal((await getIsolatedAppRelease({ ...project, currentVersion: "0.3.117" }, feed, fetcher)).updateAvailable, false);
  assert.deepEqual(requests, Array(2).fill({ url: feed, method: "GET", authorization: false }));
});

test("invalid or failed manifests fail visibly without falling back to a different update source", async () => {
  for (const value of [null, [], {}, { version: "9.9.9" }, { version: "0.3.01" }, { version: "0.3.117?secret" }]) {
    await assert.rejects(getIsolatedAppRelease(APP_UPDATE_PROJECTS[0], feed, async () => Response.json(value)), /隔离更新/);
  }
  await assert.rejects(getIsolatedAppRelease(APP_UPDATE_PROJECTS[0], feed, async () => new Response("", { status: 503 })), /HTTP 503/);
});
