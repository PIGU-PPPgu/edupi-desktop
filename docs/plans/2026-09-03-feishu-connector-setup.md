# Feishu connector setup

The setup flow is informed by Moonshot Mira's published onboarding documentation:

- [Mira documentation](https://moonshot.feishu.cn/wiki/Aa4EwFLCGiwdntklc9vcPZdsn9c)
- referenced “Mira 接入飞书组织指南” sections: create an enterprise app, add bot capability, batch-import permissions, configure long-connection events/callbacks, publish, then verify.

EduPi implements the same task sequence with a versioned maximum functional permission snapshot:

- 199 application scopes and 237 user scopes, requested on top of the Feishu PersonalAgent template;
- 2 long-connection events;
- 1 card callback;
- fixed-link handoff to the official Feishu developer console;
- App ID/Secret verification against Feishu's fixed tenant-token endpoint;
- `0600` local persistence only after verification succeeds;
- no secret echo, browser storage, model prompt, log, or Desktop projection.

The UI and registration code are original EduPi implementations. The permission-name snapshot is adapted from the MIT-licensed `riba2534/feishu-cli` repository at its pinned source revision; the Core repository records the attribution. Requesting permissions does not bypass tenant approval.

DingTalk uses its official `DING_DWS_CLAW` QR registration sequence (`init → begin → poll`). Successful authorization starts the bundled Stream runtime, which receives follow-up messages, loads the Core education projection, calls the configured model, and replies through DingTalk's session webhook. The UI reports `connected` only while the bridge process is alive.
