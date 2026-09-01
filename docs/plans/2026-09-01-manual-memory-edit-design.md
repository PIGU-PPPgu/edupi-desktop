# EduPi 手动修改记忆

## 目标

教师修改姓名、称呼、任教学科等简单事实时，不打开全局 AI 协作。记忆行提供两个独立入口：

- `手动修改`：在当前记忆行内编辑并保存。
- `AI 协作`：仅在需要梳理、推理或重写时打开全局协作。

## 数据流

`EduPiMemoryDatabase` → `POST /api/edupi/memories/:id` → Desktop `update_memory` 命令 → Core `memory_update_state.json` → 刷新 `education_workspace` → 当前页面更新。

Core 不覆盖旧的五类记忆源文件。人工修改写入版本化覆盖层，记录旧内容、revision、修改时间和 reviewer。快照只对仍存在的 active memory 应用覆盖；旧 revision、旧 snapshot、伪造来源和重复语义请求分别拒绝或幂等重放。

## 交互

点击“手动修改”后，详情区原位出现 textarea、取消、保存。保存成功后不跳页、不打开 Chat，并显示“记忆已保存”。发生并发更新时保留草稿并提示刷新后重试。

“AI 协作”保留现有确认优先提示词，继续用于复杂修订。

## 验收

- 手动修改不调用 Agent。
- 保存后 Core 快照中的 content 和 revision 更新。
- 原记忆文件字节不变，旧内容存在 revision history。
- AI 协作仍可独立打开。
- 刷新、幂等、过期 revision、API 输入边界和浏览器交互均有测试证据。
