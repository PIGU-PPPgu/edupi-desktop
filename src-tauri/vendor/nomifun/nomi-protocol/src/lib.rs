// Adapted for EduPi from NomiFun's protocol categories.
// SPDX-License-Identifier: Apache-2.0
pub mod events {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum ToolCategory {
        Info,
        Exec,
    }
}
