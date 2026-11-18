import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const linuxSourcePackages = Object.freeze([
  "libgtk-3-dev",
  "libwebkit2gtk-4.1-dev",
  "libayatana-appindicator3-dev",
  "libxdo-dev",
  "libxtst-dev",
  "libxcb1-dev",
  "libclang-dev",
  "libpipewire-0.3-dev",
  "libgbm-dev",
  "nasm",
  "dbus",
]);

// Change only the hosted runner's Ubuntu regional archive, retaining suites,
// components, signing keys, security repositories, and other package sources.
export function normalizeUbuntuArchiveSources(source) {
  return source.split("\n").map(line => {
    if (line.trimStart().startsWith("#")) return line;
    return line.replace(/https?:\/\/[^\s]+/gu, value => {
      const url = new URL(value);
      const regional = url.hostname === "azure.archive.ubuntu.com"
        || /^[a-z0-9-]+\.ec2\.archive\.ubuntu\.com$/u.test(url.hostname);
      if (!regional || url.port || url.username || url.password || url.search || url.hash
        || !/^\/ubuntu\/?$/u.test(url.pathname)) return value;
      return `https://archive.ubuntu.com${url.pathname}`;
    });
  }).join("\n");
}

export function prepareLinuxSourceDependencies({
  aptRoot = "/etc/apt",
  platform = process.platform,
  uid = process.getuid?.(),
  env = process.env,
  run = execFileSync,
} = {}) {
  if (platform !== "linux" || uid !== 0 || env.GITHUB_ACTIONS !== "true") {
    throw new Error("Linux dependency preparation requires a root GitHub Actions Linux job");
  }

  const sourceDirectory = join(aptRoot, "sources.list.d");
  const files = [join(aptRoot, "sources.list"), join(aptRoot, "apt-mirrors.txt")];
  if (existsSync(sourceDirectory)) {
    files.push(...readdirSync(sourceDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(?:list|sources)$/u.test(entry.name))
      .map(entry => join(sourceDirectory, entry.name)));
  }
  const rewritten = [];
  for (const file of files) {
    if (!existsSync(file) || !lstatSync(file).isFile()) continue;
    const original = readFileSync(file, "utf8");
    const normalized = normalizeUbuntuArchiveSources(original);
    if (normalized === original) continue;
    try {
      copyFileSync(file, `${file}.edupi-ci-backup`, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    writeFileSync(file, normalized);
    rewritten.push(file);
  }

  const acquire = [
    "-o", "Acquire::Retries=2",
    "-o", "Acquire::http::Timeout=30",
    "-o", "Acquire::https::Timeout=30",
  ];
  const options = {
    stdio: "inherit",
    env: { ...env, DEBIAN_FRONTEND: "noninteractive", NEEDRESTART_MODE: "l" },
  };
  run("apt-get", [...acquire, "-o", "APT::Update::Error-Mode=any", "update"], options);
  run("apt-get", [...acquire, "install", "--no-install-recommends", "-y", ...linuxSourcePackages], options);
  return { rewritten };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = prepareLinuxSourceDependencies();
    console.log(JSON.stringify({ status: "prepared", rewritten: result.rewritten }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
