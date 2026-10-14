# Readest Personal：Windows、Android 与个人 Google Drive

本版本基于 Readest 0.12.16，上游提交 `3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3`（2026-10-14）。目标是使用自己的 Google Drive 同步书籍、进度、书签、标注和笔记，并使用自己的翻译 API。源码沿用上游 AGPL-3.0 许可证。

## 已准备的改动

- 保留 Readest 的同步引擎、冲突处理、OAuth PKCE 和安全令牌存储。
- 通过上游的 `NEXT_PUBLIC_SELF_HOSTED=true` 开放第三方同步和自定义翻译服务，无需购买 Readest 会员。这也会开放上游归入同一自托管开关的其他本地功能；官方付费服务器仍按其自己的权限处理请求。
- 私人版名称是 **Readest Personal**，应用标识是 `com.bilingify.readest.personal`。默认数据目录与官方安装分离；桌面凭据使用独立的 `Readest Personal Safe Storage` 名称，避免共用原版的 Drive 令牌和同步口令。若手动选择自定义书库目录，也应选择独立目录。
- Google Client ID 与 Windows、Android 的回调协议由同一个脚本生成。没有配置时，不使用 Readest 官方的 Google 客户端，Drive 等待配置；本地阅读和自定义翻译可以先构建。
- 关闭官方自动更新，后续从自己的构建产物安装更新。私人版 Windows 安装器不注册与官方共享的缩略图处理器。
- GitHub Actions 包含完整单元测试、类型检查、Windows x64 NSIS 安装器和 Android arm64 签名 APK 构建。

源码中的原始 Tauri/Android 配置保持上游形式。`scripts/prepare-personal-build.mjs` **在构建时**应用私人配置；不要把它修改的原生配置再提交，否则下一次 Android 初始化可能产生重复的包目录。

## 在 GitHub 构建

1. Fork [readest/readest](https://github.com/readest/readest)，将本地 `personal-drive` 分支推到自己的 Fork。改动补丁可以应用在上述上游提交上。
2. 在 Fork 的 Actions 页面启用工作流。`personal-drive` 的相关代码推送会触发 **Build Readest Personal**。如果需要页面上的手动运行按钮，将 `personal-drive` 设为 Fork 默认分支。
3. 配置下表的 Android 签名 Secrets。它们必须长期保持一致，才能覆盖更新已经安装的私人版 APK。
4. Google Cloud 配置完成后，新增仓库 **Variable** `GOOGLE_CLIENT_ID`，再构建两端。客户端 ID 是公开信息；无需 Google Client Secret。
5. 通过后，在工作流的 Artifacts 中下载 `readest-personal-windows` 和 `readest-personal-android`。保留期为 30 天。每个包带有源码提交、子模块提交和公开客户端 ID 的构建记录。

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `GOOGLE_CLIENT_ID` | 自己 Google Cloud 项目的 OAuth 客户端 ID；可以暂时留空 |
| Secret | `ANDROID_KEY_BASE64` | 固定 JKS 签名文件的 Base64 内容 |
| Secret | `ANDROID_KEY_ALIAS` | 签名证书别名 |
| Secret | `ANDROID_KEY_PASSWORD` | 签名文件与证书共用的密码 |

本机已生成固定签名资料，位于源码仓库外的 `E:\reading\readest-personal-private`。`github-secrets.json` 包含上述三个 Secret，不能提交到源码仓库或作为构建产物发布。请备份此目录；丢失签名会影响 APK 覆盖更新。

本机已通过前端生产构建、类型与代码规范检查、工作流检查和配置脚本测试。完整单元测试有 13,600 项通过；启动时尚未准备 PDF 资源的两个测试，补齐资源后与 Drive、自定义翻译相关的复核共 85 项全部通过。尚未完成 Google 登录及两台设备同步实测。工作流配置检查不等于安装包已经生成。

## Google Cloud：下一阶段所需配置

当前实现沿用 Readest 上游的共用 **iOS 类型公开 OAuth 客户端 + PKCE + reverse-DNS 回调**。同一个客户端 ID 必须用于两端，才会在 `drive.file` 权限下访问同一套应用文件。

1. 创建自己的 Google Cloud 项目，启用 Google Drive API。
2. 配置 Google Auth Platform 的应用名称和受众；测试阶段把自己的 Google 账号加入测试用户。
3. 创建与上游实现对应的 iOS 类型客户端，Bundle ID 填 `com.bilingify.readest.personal`。这里只获取公共客户端 ID，不把 Google Secret 写进应用。
4. 设置 `GOOGLE_CLIENT_ID` 后，构建脚本自动注册回调。例如 `123-example.apps.googleusercontent.com` 对应 `com.googleusercontent.apps.123-example:/oauthredirect`。
5. Windows、Android 都在“设置 → 集成 → Google Drive”连接同一个 Google 账号，并打开书籍文件、阅读进度和笔记同步选项。

这是对现有上游实现的配置，**并非 Google 对 iOS 客户端用于 Windows、Android 的兼容承诺**。Google 文档提示 Android 类型客户端不再支持这里的自定义 URI 流程；不能只换成 Android 客户端 ID 就假定成功。真实授权是下一阶段必须验证的条件；若被拒绝，需要进一步适配 Windows 的桌面 OAuth 与 Android 原生授权，仍应放在同一个 Google Cloud 项目内。

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

Windows 构建前（有 Client ID 时先设置 `$env:GOOGLE_CLIENT_ID`）：

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
