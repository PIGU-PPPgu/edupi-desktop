// Adapted for EduPi from NomiFun's computer-use configuration.
// SPDX-License-Identifier: Apache-2.0
pub mod config {
    #[derive(Debug, Clone)]
    pub struct ComputerConfig {
        pub enabled: bool,
        pub max_screenshot_edge: u32,
    }

    impl Default for ComputerConfig {
        fn default() -> Self {
            Self {
                enabled: false,
                max_screenshot_edge: 1568,
            }
        }
    }
}
