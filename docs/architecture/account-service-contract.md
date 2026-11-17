# EduPi 账号接口

本轮交付为可配置的 Desktop 客户端和接口约定。当前产品保持本地数据模式；没有部署账号后台、短信/邮箱验证或新的微信小程序。本地可在完全不登录的情况下使用。账号服务未配置时，设置页明确显示未配置，不生成假登录或假绑定。

当前桌面入口为“设置 → 教师信息 → 账号”，设置搜索中的“小程序”“扫码 登录”“手机号”也可定位到同一卡片；原生 WebView 使用现有每进程 token 封装，开发浏览器使用普通同源请求。

账号凭据由 Desktop 宿主私有保存，与模型供应商凭据、本地 Core `local_owner`、教师背景资料、局域网手机控制配对分别管理。登录不会上传学生或材料，不会改写本地数据所有权，不自动迁移或合并资料。后续云同步或本地资料与账号关联需要独立、显式的产品流程和 Core 契约。

## 原项目参考

只读参考 Headteacher-helper `f174c28d`：

- `src/pages/DesktopConsole.tsx:2104`、`src/desktopServices.ts:23`：申请票据、显示普通二维码、小程序内确认、电脑轮询、恢复会话。
- `cloud/apiCore/index.js:30114` 和 `cloud/desktopWeb/app.js:1004`：原票据创建和消费；`src/pages/Scan.tsx:48` 为小程序扫码确认。
- `cloud/apiCore/wechatIdentityStore.js:40`：可信微信身份关联到同一教师主体，拒绝冲突。

采用同样的扫码与确认体验，不复用原 CloudBase、Cookie、AppID、账号或云函数。原源码中的同一个二维码 secret 同时参与扫描和领取；新接口将扫描凭据、仅 Desktop 持有的 device code、领取证明分离，并要求幂等换取会话。原手机号和邮箱绑定没有对应可直接复用的实现，此处属于新增的未来服务契约。

## 配置

由部署者给本地服务设置：

```text
EDUPI_ACCOUNT_SERVICE_URL=https://accounts.example.test
EDUPI_ACCOUNT_CLIENT_ID=edupi-desktop
```

URL 可以包含固定服务前缀，不能含用户信息、查询参数或 fragment；所有请求只发送到这一固定地址，不跟随重定向。没有默认云地址，不自动连接任何第三方账号服务。连接地址由管理员配置，不接受页面或模型传入远端 URL。

仅隔离开发测试支持显式 `EDUPI_ACCOUNT_ALLOW_LOOPBACK=1` 和 localhost/127.0.0.1/::1 的 HTTP；`NODE_ENV=production` 不接受这一例外。真实服务使用 HTTPS。

所有响应和 POST 请求带 `contract: "edupi-account-v1"`。该协议参考设备授权流程及 S256 领取证明，但不是对完整 OAuth/OIDC 规范兼容性的声明。参考资料：RFC 8628 的设备码、有效期、轮询间隔、`slow_down` 和过期语义；RFC 7636 的 S256；微信小程序官方 `code2Session`、`getPhoneNumber` 文档。微信凭据交换与短信/邮箱验证只在可信后台进行。

## Desktop 本地接口

`GET /api/edupi/account` 返回 `AccountReply`，`POST` 接收以下动作：

```ts
type AccountAction =
  | { action: "start"; purpose: "login" | "bind_phone" | "bind_email" | "bind_wechat" }
  | { action: "poll"; flowId: string }
  | { action: "cancel"; flowId: string }
  | { action: "refresh" }
  | { action: "logout" };
```

响应为 `{status, warning?}`：

```ts
type AccountStatus = {
  configured: boolean;
  serviceOrigin: string | null;
  state: "unconfigured" | "signed_out" | "signed_in" | "expired";
  account: {
    id: string;
    displayName: string;
    identities: {kind: "wechat_miniprogram" | "phone" | "email"; label: string; verifiedAt: string}[];
  } | null;
  expiresAt: string | null;
  challenge: {
    flowId: string;
    purpose: string;
    status: "creating" | "pending" | "scanned" | "expired" | "denied";
    qrImage: string | null;
    userCode: string | null;
    expiresAt: string;
    pollAfter: string;
  } | null;
  localDataMode: "local";
};
```

本地 API 只接受 loopback、现有 Host/Origin 检查；原生宿主配置了每进程 token 时，还要求原生 token。响应均 `Cache-Control: no-store, private`。前端不能提交“已验证”或直接写入账号，不能获取 access token、refresh token、device code、领取 verifier 或外部身份 subject。

## 未来后台端点

### 创建扫码请求

`POST /v1/desktop/challenges`

```json
{
  "contract": "edupi-account-v1",
  "client_id": "edupi-desktop",
  "installation_id": "本地随机安装标识",
  "purpose": "login",
  "code_challenge": "SHA256(code_verifier) 的 base64url",
  "code_challenge_method": "S256"
}
```

绑定目的请求必须有 `Authorization: Bearer <现有账号access_token>`，后台将目标账号固定为该凭据对应的账号。Desktop 安装标识只是随机设备标识，不证明身份，不参与合并教师或学生数据。

请求头 `Idempotency-Key` 是本地 flow UUID。相同 key 和同一输入须返回同一未过期请求；同 key 不同输入拒绝。响应：

```json
{
  "contract": "edupi-account-v1",
  "challenge_id": "不含私密信息的请求ID",
  "device_code": "至少32字符的随机领取凭据",
  "user_code": "手机与电脑都显示的核对码",
  "expires_in": 300,
  "interval": 5,
  "qr_png_base64": "仅PNG字节的base64"
}
```

Desktop 接受 30–600 秒有效期，轮询最少5秒，初始 interval 最多60秒。PNG 最大约525 KiB、边长最多2048。二维码可以是普通二维码或后台生成的小程序码。**二维码只能包含短期扫描确认凭据，不能包含 `device_code`、`code_verifier`、access/refresh token。**未来小程序扫描后必须展示登录设备、操作类型和核对码，并由用户明确确认。

### 小程序端确认

这是未来后台的责任，不是本轮本地 API：

1. 从微信可信身份或后端验证过的登录态解析唯一账号；不能信任客户端填写的 OpenID、UnionID、手机号或邮箱。
2. 根据二维码的短期扫描凭据查询请求，核对未过期、未撤销、用途和绑定的目标账号。
3. 展示设备与核对码，用户确认后授权该请求；拒绝则写 denied。扫码本身只可写 scanned，不能直接发放会话。
4. 手机号通过平台服务端验证码或授权 code 验证，邮箱通过独立验证邮件/验证码验证；完成后更新同一个账号 ID 的身份记录。
5. 账号绑定冲突必须返回冲突，不能仅因为姓名、手机号或邮箱相同就静默合并账号。OpenID 必须带应用 namespace，UnionID 必须带平台 namespace。

### Desktop 轮询

`POST /v1/desktop/challenges/{challenge_id}/poll`：

```json
{"contract":"edupi-account-v1","device_code":"仅宿主持有的领取凭据"}
```

响应 `{contract, challenge_id, status}`，状态为 `pending | scanned | slow_down | denied | expired | authorized`。`authorized` 额外返回 `authorization_code`，至少32字符，绑定请求和 S256 证明。扫码凭据不能调用此端点领取授权码。

`slow_down` 将本地后续间隔增加5秒；过期或拒绝停止自动轮询。Desktop 服务还限制早到与并发轮询，UI 使用串行 timeout，关闭设置页后停止轮询与迟到界面更新。

### 换取与刷新会话

`POST /v1/desktop/token`，换取：

```json
{
  "contract":"edupi-account-v1",
  "grant_type":"mini_program_code",
  "client_id":"edupi-desktop",
  "challenge_id":"请求ID",
  "authorization_code":"授权码",
  "code_verifier":"原申请电脑持有的证明"
}
```

响应 `{contract, token_type:"Bearer", access_token, refresh_token?, expires_in}`。access/refresh token 至少32字符，access 有效期30秒至24小时。`Idempotency-Key` 为同一 flow UUID。

**后台必须验证 challenge 绑定及 S256；同一 flow 的换取在响应丢失后可幂等恢复同一有效会话。**Desktop 在换取前持久保存授权码；请求失败、进程重启后继续使用同一 code 和 key，不创建第二份账号。若扫码已取消或过期，迟到凭据不得落入本地会话。

刷新同一端点：`{contract, grant_type:"refresh_token", client_id, refresh_token}`。key 为 `refresh-<私有本地session UUID>`。后台须在响应丢失时支持同一 key 重放刷新结果；不能因第一次成功轮换而把重试误判成新攻击。Desktop 会在刷新后再次读取权威资料，账号 ID 必须不变。

### 权威账号资料

`GET /v1/me`，要求 Bearer 凭据：

```json
{
  "contract":"edupi-account-v1",
  "account":{
    "account_id":"独立稳定账号ID",
    "display_name":"教师称呼",
    "identities":[
      {"kind":"wechat_miniprogram","namespace":"微信小程序AppID","subject":"可信OpenID","label":"微信已连接","verified_at":"2026-11-16T00:00:00.000Z"},
      {"kind":"phone","namespace":"手机号验证服务","subject":"服务端身份ID","label":"138****0000","verified_at":"2026-11-16T00:00:00.000Z"},
      {"kind":"email","namespace":"邮箱验证服务","subject":"服务端身份ID","label":"t***@example.test","verified_at":"2026-11-16T00:00:00.000Z"}
    ]
  }
}
```

每种身份有非空、真实的 `verified_at`。绑定成功后的账号 ID 必须等于绑定前账号，且包含所请求身份；不满足时不替换本地登录。后端返回脱敏 label，原始身份 subject 只留在宿主私有记录中，不交给 WebView。后台负责持久唯一关联、验证审计与冲突处理。

### 取消与退出

- `POST /v1/desktop/challenges/{id}/cancel`，`{contract, device_code}`：后台撤销未完成请求，必须幂等。本地先失效 flow，再尝试远端取消；网络断开也不会重新采用迟到结果。
- `POST /v1/desktop/revoke`，Bearer access token，`{contract, token:refresh_token或access_token}`：后台撤销该设备会话及对应刷新链。退出本地先清空凭据和未完成请求，远端失败明确显示未确认，不删教师资料。
- 非2xx、非JSON、错误 contract、过大响应及重定向都拒绝。401 表示会话失效，429 表示限流；不能把服务端原始错误或私密值直接传回界面。

## 存储、测试与边界

宿主在 `PI_DESKTOP_STATE_DIR/account/account-private.json` 保存单一账号会话及未完成 flow；普通 Web 模式默认使用 Pi agent 目录下独立的 `edupi-desktop/account/`。目录0700、文件0600、原子写、文件锁、拒绝符号链接/多硬链接/不安全权限。凭据为权限受控的本地文件，未声称使用系统钥匙串或静态加密。现有模型凭据文件和业务数据根不改动。

服务地址或 clientId 改变时，旧凭据不会发送给新服务。需要先恢复原配置退出，再切换服务。正常退出只影响本设备账号连接。

`scripts/fixtures/edupi-account-fixture.mjs` 为独立本机合成服务，生产代码不导入。其 PNG 是明确标记的测试占位图，不能用微信扫描；用于真实客户端 HTTP、状态、会话、绑定、失败与 UI 验证。没有部署真实后端时，不将合成端通过记作真实小程序登录通过。
