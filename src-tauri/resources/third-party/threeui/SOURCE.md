# ThreeUI source record

- Project: ThreeUI
- Source bundle: https://threeui.com/source-code/warp-field.json
- Registered source revision: `SHA-256 bd7c486164d8`
- Verification package: `@designcodeio/threeui@1.1.0`
- Package integrity: `sha512-7VOgCL0dswnQaGy/kkqQe3wMfLSAJ5JlzmrSjT6B7wkM+QHXmtH84CKN3kroT2xA3JdXr1/HZ6y8+VCENOe0ag==`
- License: MIT
- Copyright: 2026 Meng To

Registered files verified before integration:

- `src/shaders/warp-field/WarpFieldBackground.tsx`: `sha256:c78637ee3419deed6c364f4252ed77adfda3a215eb1b82510450a9b7fadefcbe`
- `src/shaders/warp-field/warpFieldRenderer.ts`: `sha256:c9872c53dd505dea2d87c79e34b9eedd358b5dc32b385d48280fe252f595a44e`
- `src/shaders/threeui.css`: `sha256:efe4447139f1358dd8e9be68edf6fa46cbefbd1de423a4d6c439ca61d2c8eccf`

EduPi vendors the three registered files byte-for-byte at their authored paths and imports `WarpFieldBackground` directly. The exact shared stylesheet is served unchanged from `public/threeui/threeui.css`, because processing the package-wide stylesheet would change its registered bytes. Runtime uses the registered `three128` alias (`three@0.128.0`). EduPi only supplies the registered props and positions the returned background behind the welcome content.
