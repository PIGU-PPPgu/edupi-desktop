// Adapted for EduPi from NomiFun's native Tool trait.
// SPDX-License-Identifier: Apache-2.0
use async_trait::async_trait;
use nomi_protocol::events::ToolCategory;
use nomi_types::tool::{JsonSchema, ToolResult};
use serde_json::Value;

pub fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> JsonSchema;
    fn is_concurrency_safe(&self, input: &Value) -> bool;
    async fn execute(&self, input: Value) -> ToolResult;
    fn category(&self) -> ToolCategory;
    fn category_for(&self, input: &Value) -> ToolCategory;
    fn describe(&self, input: &Value) -> String;
}
