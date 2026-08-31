// Adapted for EduPi from NomiFun's nomi-types tool boundary.
// SPDX-License-Identifier: Apache-2.0
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type JsonSchema = Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolImage {
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
    pub images: Vec<ToolImage>,
}

impl ToolResult {
    pub fn text(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            is_error: false,
            images: Vec::new(),
        }
    }

    pub fn error(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            is_error: true,
            images: Vec::new(),
        }
    }

    pub fn with_images(mut self, images: Vec<ToolImage>) -> Self {
        self.images = images;
        self
    }
}
