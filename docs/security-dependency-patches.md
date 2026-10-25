# Dependency security patches

The npm high/critical gate remains unchanged. No advisory is allowlisted.

## Pi 1.0.2

The four Desktop Pi packages are fixed to the Core 1.0.2 baseline. Upstream
removed its published shrinkwrap in 1.0.1 and now resolves secure Undici,
brace-expansion and minimatch versions without modifying installed packages.
The old 0.84.1 postinstall replacement script has been removed. `npm ci` and
the installed-tree regression still verify actual resolutions, not just the lock.

Undici remains explicitly pinned to 8.12.2. npm 10 failed to resolve the previous
`$undici` override during the major upgrade; the explicit version preserves the
Desktop network security bound without changing the Pi 1.0.2 or Core identities.
The high/critical audit gate is unchanged.

`core_sdk` in the compatibility manifest binds the Desktop SDK and Core Durable
versions. Release verification rejects a stale Desktop Pi version, and Core
staging verifies Core's package versions and the fixed Durable bundle's identity
against the runtime component manifest. Durable remains a Core-owned, default-off
internal executor; Desktop does not create a second execution database.

## OpenConnector 1.6.5

The mail dependency is scoped to Nodemailer 10.1.4. The catalog/Console version
and Action deny-all policy remain unchanged. Regression tests compose and parse
MIME in memory, with no SMTP connection or outgoing message.

## Why these dependencies are present

Undici is the existing HTTP client, not a new application framework.
`instrumentation.ts` configures the proxy-aware dispatcher in
`lib/http-dispatcher.ts`; the configured update proxy also uses Undici directly.
Pi and OpenAI SDK paths share that resolved package. Node's embedded Undici is a
separate copy; upgrading the npm package does not change the Node binary.

Nodemailer arrives through OpenConnector's full catalog package, both as a mail
implementation and through `mailparser`'s address parser. The catalog host blocks
all Actions and Proxies by default, and the Console is read-only. Including the
package does not enable mail sending. The full
catalog therefore carries implementation dependencies for capabilities that are
not currently exposed; reducing that closure is a separate architectural change.

Security advisories identify affected package versions, not evidence that an
attack occurred. A single vulnerable leaf can also appear under multiple SDKs in
an audit report. Locking versions makes builds reproducible; new advisories still
require compatible dependency updates and behavioral regression checks.

The current tests cover SRI token case handling, rejected truncated/over-encoded
responses through the actual Desktop dispatcher, bounded EventSource parser
state, and recipient-domain boundaries through parsing and in-memory MIME.
MimeNode's existing normalization of angle characters inside quoted local parts
is unchanged; these tests do not claim full quoted-mailbox preservation or real
SMTP interoperability.

## Native updater

The JavaScript updater remains 2.14.0, with Tauri 2.12 and its matching API.
The Rust updater uses the official 2.14.0 source plus the upstream Windows ZIP 9
dependency patch recorded in [ZIP-PATCH.md](../src-tauri/vendor/security-patches/ZIP-PATCH.md).
Its install entry verifies the package bytes again before filesystem access.
The macOS installer also includes upstream's 2.13.2 bundle exchange and recovery
fix: a failed replacement restores the previous app or preserves its backup and
reports the path if restoration fails. See the [upstream release](https://github.com/tauri-apps/plugins-workspace/releases/tag/updater-v2.14.0).

The mock-runtime tests accept a valid public test signature and reject changed
bytes, changed trusted comments and a signed-version mismatch before installation.
They do not install a valid package or test App replacement. The existing
minisign-verify 0.2.5 already checks canonical Ed25519 scalars; 0.3.0 preserves that
protection and is not presented as a newly repaired vulnerability here.

Transport verification, downgrade defaults, signing keys and feeds are unchanged.
`requireSignedVersion` stays at its default `false` for existing unversioned
signatures. The new plugin still rejects a mismatched version when a signed
trusted comment includes one; this check did not exist in the old plugin.
No restore-from-cache feature is enabled. The plugin's new default `system-proxy`
feature uses OS proxy settings when no explicit updater proxy is supplied, matching
the existing settings UI; explicit loopback proxy forwarding remains tested.
The published updater 2.14.0 still requires Windows-only ZIP 4; the local parent
patch moves that reader to the locked ZIP 9.0.5 without changing codecs or
disabling ZIP support. Unix library regressions retain their synthetic fixtures;
they are separate from deferred Windows compilation and installation.

## Rust maintenance dependencies

The complete lock uses published GTK 0.19 / GLib 0.22 and zbus 6.1 instead of the
retired GLib macro and split D-Bus type crates. Parent adapters preserve Linux
notifications, single-instance callbacks, portal/Wayland and AT-SPI behavior.
Archive checksums, exact local differences and removal criteria are recorded in
[GTK-PATCHES.md](../src-tauri/vendor/security-patches/GTK-PATCHES.md) and
[ZBUS-PATCHES.md](../src-tauri/vendor/security-patches/ZBUS-PATCHES.md).
Linux source checks use Rust 1.92; the macOS compiler floor remains 1.90.

The withdrawn ChaCha20 and Windows clipboard versions are replaced by their
compatible 0.10.2 and 5.4.3 releases. Version guards do not replace behavioral
tests or the full `cargo audit --deny warnings` gate. No advisory is allowlisted,
target-filtered or suppressed. Third-party Rust source includes embedded
JavaScript, which is excluded from application ESLint; application rules remain
enabled and the native code is checked by Rust and targeted protocol tests.

## Next lint

Next and its lint config are 16.4.2. The private `vendor/next-root-glob` adapter
replaces their only fast-glob call; all lint rules remain enabled. Its README
records scope, sources and removal criteria. Tests cover root-directory matching
and the actual internal-link rule, not just dependency metadata.

Recheck these temporary integrations by 2026-11-03.
