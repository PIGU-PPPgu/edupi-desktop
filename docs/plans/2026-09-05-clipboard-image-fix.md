# Desktop clipboard image fix — 2026-09-05

The existing native fallback called clipboard read_image followed by core image rgba/size, but the loopback WebView capability granted only read_image. Both image operations need explicit permissions. Their failure was swallowed as an empty clipboard.

The fix grants rgba and size to the existing main-window capability. The composer counts readable image files rather than metadata items, also accepts clipboardData.files, and falls back to native reading when metadata yields no file and no plain text is present. Plain text keeps its usual paste behavior; a readable browser image takes priority to avoid duplicate attachments.

Verification: clipboard focused tests, TypeScript, ESLint and cargo check passed. Packaged keyboard-paste verification is recorded in the PR after installation. No model send is required to check an attachment preview.

Installed app verification: macOS screenshot shortcut followed by Command-V in a blank EduPi chat produced an image thumbnail and enabled Send. Removed the unsent test attachment; no model request was made. Full suite: 877 passed, 16 skipped, 0 failed. App/DMG generation completed; updater signing remains unavailable without the release private key. The installed app is locally ad-hoc signed; previous installation was moved to Trash for recovery.
