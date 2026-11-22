# EduPi iOS

EduPi iOS 使用原生 SwiftUI。底栏包含首页、AI 协作、工作区、班级和日程。使用引导在首页账户菜单中打开。

## 界面组件

`EduPiDesignSystem.swift` 按 Pigou UI 的 `card`、`button`、`icon-button` 实现 SwiftUI 控件，使用 `app/native-theme.css` 中的 EduPi 亮色和深色主题。底栏和筛选分别使用系统的 `TabView` 与 `Picker`。

## 数据

登录后从所选云端工作区读取学生、任务、校历和课表。观察记录使用学生事件接口，材料和教育记忆走带工作区权限的列表接口。

AI 对话依赖云端会话服务。任务变更、材料上传和校历导入的手机端接入尚待完成。本地预览的消息和任务操作仅保存在本次预览中。

## 在 Xcode 中运行

打开 `ios/EduPi.xcodeproj`，选择 iPhone 模拟器并运行 EduPi。登录页的「本地预览」可直接打开示例工作区。Debug 构建也可用 `-edupi-offline` 启动参数进入同一预览。

连接 iPhone 或上传 TestFlight 时，在 `Signing & Capabilities` 中选择拥有 App 签名权限的 Apple Team。配置服务地址时填写最终的 HTTPS 地址。App 将登录令牌保存在系统钥匙串。

真实 public key 从私有 Xcode 配置的 `SUPABASE_PUBLISHABLE_KEY` build setting 注入；`Info.plist` 只引用该变量。不要将真实 key、测试密码、service role key 或签名材料提交到仓库。
