# EduPi desktop chrome and icon rail — design QA

- Source visual truth: user-attached `codex-clipboard-53c28811-ad08-469b-b3cf-9d5de6fbd465.png` (session path intentionally omitted; 2880 × 1800 px).
- Expanded implementation: `/tmp/edupi-expanded-qa.png` (1440 × 900 px).
- Collapsed implementation: `/tmp/edupi-collapsed-qa.png` (1440 × 900 px).
- Combined comparison: `/tmp/edupi-design-qa-comparison.png` (source normalized above expanded and collapsed implementations).
- CSS viewport: 1440 × 900.
- Density normalization: the 2× source was downsampled from 2880 × 1800 to 1440 × 900; implementation captures were 1× at the same CSS size.
- State: light theme, AI 协作, expanded and collapsed primary navigation.

**Findings**

- No actionable P0/P1/P2 differences remain.
- The expanded rail preserves the source hierarchy, 220 px track, typography, neutral palette, borders, session sidebar and main composer placement.
- The collapsed state now uses a conventional 58 px icon rail. All 11 module buttons remain visible; active state, pending-review badge, activity indicator, tutorial and management controls remain available. Labels are hidden visually and retained through titles and accessible names.
- Packaged desktop mode adds a separate 28 px first grid row carrying the existing Tauri drag-region contract. It participates in layout rather than covering buttons with an absolute overlay.

**Required Fidelity Surfaces**

- Fonts and typography: unchanged from the source-aligned EduPi system stack; weights, truncation and hierarchy remain stable.
- Spacing and layout rhythm: expanded proportions are unchanged. The collapsed 58 px rail uses centered 40 px controls and consistent vertical spacing. Desktop-only content begins below the new 28 px drag row.
- Colors and tokens: uses the existing `--ep-*` tokens; no new palette, gradient or shadow system was introduced.
- Image and icon quality: no raster assets were required. Existing product navigation icons are reused at their authored size; no replacement placeholders were introduced.
- Copy and content: module names and teacher content are unchanged. Collapsed labels move into native title/ARIA affordances instead of being deleted.

**Interaction Evidence**

- Collapse: 220 px → 58 px.
- Expand: 58 px → 220 px.
- Collapsed module icons: 11/11 visible.
- Browser console: zero errors and warnings.
- Desktop drag contract: `data-tauri-drag-region`, `core:window:allow-start-dragging`, and packaged-app build are all verified. Automated physical window movement was unavailable because macOS did not expose the EduPi window to the accessibility driver during this run.

**Comparison History**

1. Earlier P1: collapsing reduced the rail to 22 px and hid every module. Fixed with the persistent 58 px icon rail; post-fix capture shows all navigation icons and utilities.
2. Earlier P1: EduPi mode hid AppShell's normal top bar and therefore exposed no drag surface. Fixed with the desktop-only 28 px grid row; controls are shifted below it rather than occluded.

**Follow-up Polish**

- P3: the expand/collapse control displays the normal focus ring immediately after keyboard or automated activation. This is intentional accessibility feedback and disappears when focus moves.

final result: passed
