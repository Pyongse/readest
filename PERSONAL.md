# Readest Personal：Windows、Android 与个人 Google Drive

本版本基于 Readest 0.12.16，上游提交 `3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3`（2026-10-14）。目标是使用自己的 Google Drive 同步书籍、进度、书签、标注和笔记，并使用自己的翻译 API。源码沿用上游 AGPL-3.0 许可证。

## 已准备的改动

- 保留 Readest 的同步引擎、冲突处理、OAuth PKCE 和安全令牌存储。
- 通过上游的 `NEXT_PUBLIC_SELF_HOSTED=true` 开放第三方同步和自定义翻译服务，无需购买 Readest 会员。这也会开放上游归入同一自托管开关的其他本地功能；官方付费服务器仍按其自己的权限处理请求。
- 私人版名称是 **Readest Personal**，应用标识是 `com.bilingify.readest.personal`。默认数据目录与官方安装分离；桌面凭据使用独立的 `Readest Personal Safe Storage` 名称，避免共用原版的 Drive 令牌和同步口令。若手动选择自定义书库目录，也应选择独立目录。
- 私人版分别接入自己的 Desktop 和 Android OAuth 客户端。Windows 使用系统浏览器、PKCE 和本机随机端口回调；Android 使用 Google 原生授权 SDK，后台续期固定已连接账号。真实登录与双端同步仍需设备验收。
- 关闭官方自动更新，后续从自己的构建产物安装更新。私人版 Windows 安装器不注册与官方共享的缩略图处理器。
- GitHub Actions 包含完整单元测试、类型检查、Windows x64 NSIS 安装器和 Android arm64 签名 APK 构建。

源码中的原始 Tauri/Android 配置保持上游形式。`scripts/prepare-personal-build.mjs` **在构建时**应用私人配置；不要把它修改的原生配置再提交，否则下一次 Android 初始化可能产生重复的包目录。

## 在 GitHub 构建

1. Fork [readest/readest](https://github.com/readest/readest)，将本地 `personal-drive` 分支推到自己的 Fork。改动补丁可以应用在上述上游提交上。
2. 在 Fork 的 Actions 页面启用工作流。`personal-drive` 的相关代码推送会触发 **Build Readest Personal**。如果需要页面上的手动运行按钮，将 `personal-drive` 设为 Fork 默认分支。
3. 配置下表的 Android 签名 Secrets。它们必须长期保持一致，才能覆盖更新已经安装的私人版 APK。
4. Google Cloud 配置按 [详细操作指南](GOOGLE_OAUTH_SETUP.md) 创建同一项目下的 Desktop 和 Android 客户端，分别设置下表的两个仓库 Variable。构建脚本要求两者同时配置、属于同一项目，也允许两者都留空以生成仅用于本地阅读的版本。
5. 通过后，在工作流的 Artifacts 中下载 `readest-personal-windows` 和 `readest-personal-android`。保留期为 30 天。每个包带有源码提交、子模块提交和公开客户端 ID 的构建记录。

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `GOOGLE_DESKTOP_CLIENT_ID` | 自己 Google Cloud 项目的 Desktop app 客户端 ID |
| Variable | `GOOGLE_ANDROID_CLIENT_ID` | 同一项目的 Android 客户端 ID；包名和签名指纹须匹配私人版 |
| Secret | `GOOGLE_DESKTOP_CLIENT_SECRET` | Desktop 凭据 JSON 的 `installed.client_secret`；仅提供给 Windows 构建 |
| Secret | `ANDROID_KEY_BASE64` | 固定 JKS 签名文件的 Base64 内容 |
| Secret | `ANDROID_KEY_ALIAS` | 签名证书别名 |
| Secret | `ANDROID_KEY_PASSWORD` | 签名文件与证书共用的密码 |

本机已生成固定签名资料，位于源码仓库外的 `E:\reading\readest-personal-private`。`github-secrets.json` 包含 Android 的三个签名 Secret，不能提交到源码仓库或作为构建产物发布。请备份此目录；丢失签名会影响 APK 覆盖更新。

桌面 Google 凭据 JSON 保存在同一私有目录的 `google-desktop-oauth.json`，不提交源码。2026-10-15 用明确无效的测试授权码向 Google 进行参数预检时，桌面客户端在缺少 `client_secret` 时返回了 `invalid_request: client_secret is missing`，因此桌面构建需要上述 Secret。它只用于 Google 的令牌交换和刷新请求，不放入浏览器授权 URL、源码、构建来源记录或 Android 包。

原生桌面客户端无法把安装包中的静态 OAuth 客户端凭据真正保密；GitHub Secret 保护的是源码与构建日志，桌面应用运行时仍须携带此配置。用户授权码、访问令牌、刷新令牌和 Android 签名私钥是另一类资料，不能作为客户端配置公开。

本机已通过前端生产构建、类型与代码规范检查、工作流检查和配置脚本测试。GitHub 的完整检查已通过：1,149 个测试文件、13,612 项测试通过，另有上游原有的 4 个文件、16 项测试跳过。Windows 安装包与 Android arm64 APK 均已在 GitHub 构建成功，APK 签名校验通过。尚未完成安装后的真实设备验收、Google 登录及两台设备同步实测。

本次双端构建来源为提交 `3ab3fc78e645ceb1b81aff8d80f49c2d36183673`，[完整工作流结果](https://github.com/Pyongse/readest/actions/runs/38540782594)已通过。安装包、构建来源记录和 SHA-256 校验值已下载到 `E:\reading\readest-packages`。按用户选择，Fork 原有的官方工作流保持启用。

## Google Cloud：下一阶段所需配置

Google [OAuth 政策](https://developers.google.com/identity/protocols/oauth2/policies)要求各平台分别注册匹配类型的客户端。之前沿用上游共用 iOS 客户端的方案不应作为 Windows、Android 的正式接入方案，现已停止推荐。

请按 [Google Cloud 详细操作指南](GOOGLE_OAUTH_SETUP.md)在同一个 Cloud 项目创建 **Desktop app** 和 **Android** 两个客户端。对应的 Windows 回调和 Android 原生授权已接入私人版；两端使用同一项目和同一 Google 账号，仍需验证 `drive.file` 文件互见及同步行为。现有基础安装包不含此配置，必须使用完成这次授权适配后重新构建的安装包。

Android 需要可用的 Google Play services。它只在系统安全存储中保存账号和客户端绑定记录，访问令牌留在内存，续期由 Google 服务处理；Windows 的刷新令牌保存在独立系统凭据库。断开连接只清除本机连接，不撤销同一项目其他设备的 Google 授权。需要重新授权时，在“设置 → 集成 → Google Drive”点击“重新连接”。

Android 的包名为 `com.bilingify.readest.personal`，固定签名证书 SHA-1 为 `4A:5D:3F:F0:98:C9:C3:3B:FE:5E:C5:08:F6:7C:18:43:39:E0:91:A4`。

权限只申请 `https://www.googleapis.com/auth/drive.file`，访问应用创建或获授权的文件，不申请整个 Drive 的完整访问权限。Google 项目处于外部应用的 Testing 状态时，带 Drive 权限的 refresh token 通常会在 7 天后过期；长期使用需确认项目发布状态。

## 配置自己的翻译 API

打开“设置 → 语言 → 自定义翻译服务 → 添加翻译服务”。

- 类型：**OpenAI Compatible**。
- 名称：自己容易识别的服务名称。
- Base URL：服务商提供的兼容接口根地址，通常包含 `/v1`。不要填到 `/chat/completions`。
- API Key：直接在应用内填写，不放进源码、仓库 Variable 或构建 Secrets。
- 模型：填写该服务实际提供的模型 ID，或者使用获取模型列表按钮。
- 点击 **Test / 测试**，确认有翻译结果后保存；然后将翻译服务和目标语言设为所需选项。

也可以选 **DeepL** 类型，使用自己的 DeepL Key。OpenAI 兼容模式包含 DeepSeek、OpenRouter、自建兼容网关、Ollama 等入口；具体地址、模型和计费以你自己的服务配置为准。没有调用过任何真实付费 API。

支持自定义提示词，包含 `{{sourceLang}}`、`{{targetLang}}`、`{{bookTitle}}`、`{{bookAuthor}}` 变量。请求由设备直接发送给所配置的服务。Windows 本机服务的 `127.0.0.1` 不等于 Android 手机上的电脑地址；手机访问电脑上的翻译服务时需要填写可达的局域网地址。

同步设置中的 API Key 会走上游的加密同步中间件：设置加密口令后才可跨端传递，未设置时不会明文同步密钥。可以先在两台设备各自填写 Key。

## 本地构建与维护

当前本机已具备 Node.js、pnpm 和 Java，尚缺 Rust 和 MSVC Windows 构建工具。自动构建在 GitHub 托管的 Windows/Ubuntu 环境里安装这些依赖。本机不需要为了上传源码而安装完整原生工具链。

在仓库根目录运行下面的准备和检查命令（Windows PowerShell）：

```powershell
git -c http.sslBackend=openssl submodule update --init --recursive packages/foliate-js packages/simplecc-wasm packages/js-mdict packages/qcms packages/tauri apps/readest-app/src-tauri/plugins/tauri-plugin-turso apps/readest-app/src-tauri/plugins/tauri-plugin-webview-upgrade
pnpm install --frozen-lockfile
pnpm --filter @readest/readest-app setup-vendors
node --test scripts/personal-build.test.mjs
pnpm test --run --maxWorkers=4
pnpm lint
```

Windows 构建前，先设置 `$env:GOOGLE_DESKTOP_CLIENT_ID` 和 `$env:GOOGLE_ANDROID_CLIENT_ID`，并从私有 Desktop JSON 读取 `$env:GOOGLE_DESKTOP_CLIENT_SECRET`：

```powershell
node scripts/prepare-personal-build.mjs
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
```

Android 的初始化顺序必须遵循工作流：先使用未修改的上游配置初始化 Android，再恢复上游提交的 `gen/android` 文件，生成图标，最后运行私人配置脚本。上游的 MainActivity、FOSS 依赖选择、Manifest 与资源文件都需保留；不能只使用 Tauri 初始模板。

合并上游前，恢复构建脚本修改的原生配置，并保留 `personal-drive` 上的源码改动。获取上游后合并，再运行检查与自动构建。不要在有未保存业务改动时直接恢复文件。

本机验证 GitHub 代理成功：`http://127.0.0.1:7890`。代理只用于需要的网络操作，不修改整个系统的代理设置。

## 双端验收清单

以下项目均需要 Google 配置和真实设备，当前尚未执行：

| 场景 | 应观察到的结果 |
| --- | --- |
| Windows 导入 EPUB/PDF，Android 刷新 | 同一本书可下载并正常打开 |
| Windows 阅读并关闭书籍，Android 打开 | 跳到最近同步的位置 |
| Android 新建书签、标注、笔记，Windows 刷新 | 对应内容与定位均一致 |
| 两端离线修改再恢复联网 | 无异常覆盖；核对上游冲突合并行为 |
| 两端退出并重新启动 | Drive 登录仍有效，书籍和阅读数据保留 |
| Google 测试授权超过 7 天或撤销授权 | 明确提示重新授权，而不是悄悄同步到 Readest Cloud |
| 两端分别填写自己的翻译 API 配置 | 测试翻译成功，阅读时可以使用该服务 |
| 安装下一次签名 APK | 能覆盖安装，原有本地书库和进度保留 |

## 参考来源

- [Readest 上游源码与许可](https://github.com/readest/readest)
- [Readest 官方自托管开关](https://github.com/readest/readest/blob/main/docker/README.md)
- [类似项目：Readest-google-drive-mod-patcher](https://github.com/ratatabananana-bit/Readest-google-drive-mod-patcher)：参考了客户端 ID 与回调统一、隔离安装和 Android 初始化后保留上游原生行为的思路；未套用它的额外书架功能或预编译安装包。
- [rea](https://github.com/morluto/rea)：已查看其适用范围；本阶段直接分析公开源码，未安装二进制逆向工具。
- [Google 原生应用 OAuth 说明](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google OAuth 令牌过期说明](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Google Drive 权限范围说明](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
