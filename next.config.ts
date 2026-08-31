import type { NextConfig } from "next";

const isDesktopBuild = process.env.PI_WEB_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  agentRules: false,
  outputFileTracingRoot: __dirname,
  ...(isDesktopBuild
    ? { output: "standalone" as const, distDir: ".next-desktop" }
    : {}),
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "mammoth",
  ],
  experimental: {
    optimizePackageImports: ["@lobehub/icons", "react-syntax-highlighter"],
  },
  allowedDevOrigins: ["192.168.*.*"],
  devIndicators: false,
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals = [...(config.externals ?? []), "undici"];
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
