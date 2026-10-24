# OpenConnector provider metadata

`openconnector-provider-metadata.json` is a fixed metadata snapshot from the public OOMOL connector catalog at `https://connector.oomol.com/public/v1/apps`. The snapshot records its retrieval time and the SHA-256 of the source response. It contains only service IDs present in the bundled OpenConnector 1.6.5 catalog, official icon URLs, and public search aliases. It does not add providers or change executable capabilities.

OpenConnector's own Console embeds the same service-to-icon mapping during its build. Source: [provider-icons-plugin.ts](https://github.com/oomol-lab/open-connector/blob/main/web/provider-icons-plugin.ts). The pinned 1.6.5 implementation used `https://oomol.com/en/apps/catalog.json`, which returned HTTP 403 when this snapshot was prepared.

Only HTTPS icon URLs on `static.oomol.com` under `/logo/third-party/` are retained. No image files are copied. There are 1,549 matching icon URLs for the 1,554 bundled services. `aifinmarket`, `canva_cn`, `shopify_admin`, and `workday` have no direct service match in the source. `fusion-api` points outside the permitted path and its icon is omitted. Missing or failed images render service initials. The client never fetches the catalog at runtime and does not use a third-party favicon service.

The metadata supplements in `openconnector-discovery.ts` are local Chinese search vocabulary and a teacher-oriented display order. The upstream service identity, name, scenarios, actions, and authorization requirements remain authoritative.

OpenConnector source is Apache-2.0. Third-party provider names, trademarks, logos, icons, service marks, and brand assets remain the property of their respective owners. They identify interoperable services and do not imply endorsement, sponsorship, partnership, certification, or verification. See the upstream [NOTICE](https://github.com/oomol-lab/open-connector/blob/main/NOTICE.md) and [license scope](https://github.com/oomol-lab/open-connector#license-scope).
