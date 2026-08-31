# NomiFun source record

- Project: NomiFun Desktop
- Source: https://github.com/nomifun/nomifun-desktop
- ContentSider and collapse hook revision: `2d31bcb7dcbde1da50259cab90fe4efac11faa56`
- Computer Use and accessibility engine revision: `0824f455af046a9d03fb4bf768f8918a01fef665`
- License: Apache License 2.0
- EduPi adaptations:
  - `components/EduPiContentSider.tsx`
  - `hooks/useEduPiContentSiderCollapse.ts`
  - `src-tauri/vendor/nomifun/nomi-a11y/`
  - `src-tauri/vendor/nomifun/nomi-computer/`

EduPi converted NomiFun's ContentSider presentation at the first revision above to the local Next.js/Tauri component contract and EduPi CSS tokens. Its collapse-state hook was adapted to use EduPi's centralized preference registry.

EduPi vendors NomiFun's cross-platform Computer Use and accessibility engines from the second revision above. Their Cargo manifests were adapted to a minimal set of local compatibility crates so the desktop shell does not import NomiFun's unrelated server, persistence, authentication, or Agent runtime. EduPi's `src-tauri/src/computer_use.rs` is a new host safety layer: the executor is opt-in, serialized, snapshot-bound, audited, and can be stopped immediately. The Agent bridge still requires a visible teacher confirmation for every screen read or desktop mutation.

The copied component keeps its source notice and SPDX identifier. The bundled `LICENSE` and `NOTICE` files beside this record are copied from NomiFun revision `0824f455af046a9d03fb4bf768f8918a01fef665`; the nested revisions in that `NOTICE` describe NomiFun's own third-party inputs.
