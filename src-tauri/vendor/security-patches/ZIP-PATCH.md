# Updater ZIP dependency patch

Source: official `tauri-plugin-updater` 2.14.0 crate, SHA-256
`7259989d4fe11b2bf51f7d671642249b1837c4ae2da1430dc713ae38f98ceeec`.
The upstream VCS revision is `44293a5722efcaf27060504e63b17aeba721b40f`.
Original MIT/Apache licenses and VCS metadata remain in the source directory.
Standalone upstream Cargo locks are omitted; EduPi's root lock is authoritative.

The only source change is the Windows ZIP requirement `4` to `9` in both
published and original manifests, matching upstream
[ba98bfadc4c868c9a7e1a226c83af528e1f11b89](https://github.com/tauri-apps/plugins-workspace/commit/ba98bfadc4c868c9a7e1a226c83af528e1f11b89).
Default codecs, ZIP support, signature verification and updater Rust code are
unchanged. This is a local source patch to 2.14.0, not a new published updater.

The workspace locks ZIP 9.0.5. The ZIP maintainer's advisory identifies 9.0.1 as
the fix for GHSA-4684-h2q9-2vcp, while RustSec lists 9.0.0; 9.0.5 includes the
later symlink-permission fix and avoids relying on that discrepancy.
The exact Unix test dependency also keeps the unstable stream regression API
reproducible; it does not add ZIP to the normal macOS application closure.

Remove this local parent patch after a published updater adopts ZIP 9 and passes
the existing extraction, signature and update API checks. Windows compilation
and installation are separately deferred.
