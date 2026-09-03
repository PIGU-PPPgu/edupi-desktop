# Feishu connector setup

The setup flow is informed by Moonshot Mira's published onboarding documentation:

- [Mira documentation](https://moonshot.feishu.cn/wiki/Aa4EwFLCGiwdntklc9vcPZdsn9c)
- referenced “Mira 接入飞书组织指南” sections: create an enterprise app, add bot capability, batch-import permissions, configure long-connection events/callbacks, publish, then verify.

EduPi implements the same task sequence with its own narrower capability set:

- 8 tenant permissions required by the current EduPi Feishu bridge;
- 2 long-connection events;
- 1 card callback;
- fixed-link handoff to the official Feishu developer console;
- App ID/Secret verification against Feishu's fixed tenant-token endpoint;
- `0600` local persistence only after verification succeeds;
- no secret echo, browser storage, model prompt, log, or Desktop projection.

The UI and source are original EduPi implementations. No Mira source code or private permission bundle was copied.
