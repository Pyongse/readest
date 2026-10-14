# Readest Personal：自己的 Google Drive 授权配置指南

核对日期：2026-10-14。适用设备：Windows 电脑、Android 手机。以下按个人 Gmail 账号、自己使用、安装私人版 APK 的情况说明。

你负责登录 Google、创建项目和确认授权；把完成后的 **Windows Client ID 与 Android Client ID** 发给我，我负责接入源码、设置构建参数和重新生成安装包。无需提供 Google 密码、验证码、Client Secret、访问令牌或签名私钥。

## 先说明这次核对发现的变化

原源码沿用 Readest 的一个 iOS 类型客户端与自定义回调，试图在 Windows 和 Android 共用。重新核对 Google 官方政策后，**这条路线停止作为配置建议**：Google 要求为每个平台创建匹配类型的独立 OAuth 客户端；Android 类型客户端也不支持原来的自定义 URI 回调。正确方向是：**同一个 Google Cloud 项目，分别创建 Desktop app 和 Android 客户端，并让代码使用对应的平台授权方式**。[Google OAuth 平台客户端政策](https://developers.google.com/identity/protocols/oauth2/policies)、[原生应用回调要求](https://developers.google.com/identity/protocols/oauth2/native-app)

因此，下面的账号配置可以先完成，但当前安装包的 Google 登录流程仍需适配。Windows 需要桌面回调适配，Android 需要原生授权适配；由我处理这些源码和构建改动，然后再进行真实登录与同步验收。**不要把 Desktop 或 Android ID 直接替换到现有单个 `GOOGLE_CLIENT_ID` 变量后就认为已经接通。**

Google 建议同一应用的不同平台客户端放在同一项目，方便管理和跨客户端授权；这里按这个结构创建。两端是否能访问同一批 `drive.file` 文件，仍要通过后面的双设备测试确认。[Google 官方多客户端项目说明](https://developers.googleblog.com/en/get-smart-about-preparing-your-app-for-oauth-verification/)

## 1. 准备账号，进入普通控制台

1. 在电脑浏览器打开 [Google Cloud 控制台](https://console.cloud.google.com/)。如果网络需要代理，保持当前可连接 Google 的代理。
2. 登录你准备在电脑和手机上用于同步的 Google 账号。
3. 第一次进入时，按页面阅读并处理 Google 的服务条款；国家或地区填真实信息。
4. 如果页面宣传“开始免费试用 / Start free trial”，先进入普通控制台。这个教程不需要部署云服务器，也不要求主动开通试用或添加信用卡。
5. 检查右上角账号头像，避免误用另一个 Google 账号。

关于费用：Google 当前文档说明 Drive API 的标准使用不额外收费，同时注明计划在 2026 年稍后对超出配额的使用引入计费。这不等于 Google Cloud 所有产品免费，也不等于 Drive 网盘空间无限。本流程先不主动绑定结算账号；若你实际看到必须付款或绑定信用卡的提示，先把提示文字告诉我，核对它要求的是哪项产品。[Drive API 配额与计费说明](https://developers.google.com/workspace/drive/api/guides/limits)、[Google API 结算说明](https://support.google.com/googleapi/answer/6158867?hl=en)

## 2. 创建一个项目

1. 点击控制台顶部的项目名称或“选择项目 / Select a project”。
2. 点击“新建项目 / New project”。也可打开 [创建项目页面](https://console.cloud.google.com/projectcreate)。
3. 按下表填写，再点“创建 / Create”。
4. 等创建完成后，通过顶部项目选择器选中刚建的项目。后续每一步都使用这个项目。

| 字段 | 怎么填 |
| --- | --- |
| 项目名称 / Project name | `Readest Personal`；用于自己识别 |
| 项目 ID / Project ID | 保留 Google 自动生成的唯一值；不必与应用包名一样 |
| 组织 / Organization | 个人 Gmail 通常选择“无组织 / No organization” |
| 位置 / Location | 个人账号保留允许的默认值；没有组织时不需要自行购买组织服务 |

记下项目名称和项目 ID，便于以后找到它。它们不是 OAuth Client ID，不能互相替代。[Google 官方创建项目说明](https://developers.google.com/workspace/guides/create-project)

**检查结果：**顶部显示 `Readest Personal`，而不是别的项目。

## 3. 启用 Google Drive API

1. 左上角“菜单 / Menu” → “API 和服务 / APIs & Services” → “库 / Library”。
2. 搜索 `Google Drive API`。
3. 点开准确名称为 **Google Drive API** 的项目，点击“启用 / Enable”。
4. 如果已显示“管理 / Manage”，说明已经启用。

也可打开 [Google Drive API 页面](https://console.cloud.google.com/apis/library/drive.googleapis.com)，再确认顶部项目正确。本次不需要创建服务账号、API Key，也不需要开启其他存储或计算产品。[Google 官方启用 API 步骤](https://support.google.com/googleapi/answer/6158841?hl=en)

**检查结果：**当前项目的“已启用的 API 和服务 / Enabled APIs & services”中有 `Google Drive API`。

## 4. 配置 Google Auth Platform

当前界面名称通常是 **Google Auth Platform**。旧教程里的“OAuth consent screen / OAuth 同意屏幕”可能会跳转到这里。

1. 菜单 → “Google Auth Platform / Google 身份验证平台”；也可打开 [Auth Platform 总览](https://console.cloud.google.com/auth/overview)。
2. 如果提示尚未配置，点击“开始 / Get started”。
3. 按下表完成首次设置，阅读页面要求的用户数据政策后，再确认并创建。

| 设置步骤与字段 | 怎么填 |
| --- | --- |
| 应用信息 / App information → 应用名称 / App name | `Readest Personal` |
| 用户支持邮箱 / User support email | 选择你自己的常用 Google 邮箱 |
| 受众 / Audience | **外部 / External** |
| 联系信息 / Contact information → 邮箱 / Email address | 填自己的常用邮箱，用于接收 Google 通知 |
| 完成 / Finish | 阅读政策；同意后勾选相应选项并创建 |

个人 Gmail 使用 `External`。`Internal` 适用于有 Google Workspace 或 Cloud Identity 组织的项目，并不是“只有我自己用”的意思。[Google Auth Platform 首次配置](https://support.google.com/cloud/answer/15544987?hl=en)、[受众类型说明](https://support.google.com/cloud/answer/15549945?hl=en)

创建后检查“品牌信息 / Branding”：应用名和支持邮箱应准确。首次个人测试先不上传 Logo，也不要编造网站、隐私政策或把 Readest 官方网站冒充成自己的项目网站。若页面强制要求额外的链接，先把字段名称告诉我，我们为私人项目准备真实说明。品牌名称或 Logo 在授权页如何显示，与 Google 的品牌验证状态有关，可能暂时显示邮箱或项目标识。[品牌信息官方说明](https://support.google.com/cloud/answer/15549049?hl=en)

## 5. 把自己加入测试用户

1. Google Auth Platform → “受众 / Audience”。
2. 检查“用户类型 / User type”为 `External`。
3. 初次验证阶段保留“发布状态 / Publishing status”为“测试 / Testing”。
4. 找到“测试用户 / Test users”，点击“添加用户 / Add users”。
5. 填入电脑与手机实际登录 Drive 的完整 Google 邮箱，保存。
6. 如果你会用第二个自己的账号测试，也把那个账号加入；两端正式同步时仍要选同一个账号。

加入项目成员不等于加入测试用户，创建项目的账号也应在这里明确加入。Testing 状态最多允许 100 个测试用户。[Google 测试受众说明](https://support.google.com/cloud/answer/15549945?hl=en)

**检查结果：**测试用户表里能看到你将用于同步的邮箱。

## 6. 添加最小 Drive 权限

1. Google Auth Platform → “数据访问 / Data Access”。
2. 点击“添加或移除范围 / Add or remove scopes”。
3. 在范围列表搜索 `drive.file`。
4. 只选择完整值为下面这一项的范围：

```text
https://www.googleapis.com/auth/drive.file
```

5. 点击“更新 / Update”，再按页面保存。
6. 如果列表找不到，先确认第 3 步已经启用 Drive API；也可在“手动添加范围 / Manually add scopes”中输入上述完整值再更新。[Google 数据访问设置说明](https://support.google.com/cloud/answer/15549135?hl=en)

`drive.file` 是 Google 推荐的非敏感范围，只访问应用创建或用户明确向应用授权的文件。它不会自动让应用浏览整个网盘里的所有旧文件；不要为了解决找不到书的问题直接改成完整 `drive` 权限。[Drive 权限范围官方说明](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

**检查结果：**数据访问范围表中有且仅有本应用需要的 `drive.file`，没有误选“查看和管理所有 Drive 文件”。

## 7. 创建 Windows 桌面客户端

1. Google Auth Platform → “客户端 / Clients”。
2. 点击“创建客户端 / Create client”。
3. 按下表填写，点“创建 / Create”。

| 字段 | 怎么填 |
| --- | --- |
| 应用类型 / Application type | **桌面应用 / Desktop app** |
| 名称 / Name | `Readest Personal Windows` |

桌面类型通常不需要填写包名、SHA-1 或网站域名；这些字段是其他客户端类型的设置。创建后复制 **客户端 ID / Client ID**，保存时标记它属于 Windows。[Google 桌面客户端创建说明](https://developers.google.com/workspace/drive/api/quickstart/python)

ID 的样式大致如下；这只是格式示例，不能照抄：

```text
123456789012-example.apps.googleusercontent.com
```

如果创建窗口提供“下载 JSON / Download JSON”，可以下载作为自己的备份，并保存到源码仓库外的 `E:\reading\readest-personal-private\google-desktop-oauth.json`。桌面凭据 JSON 可能包含 `client_secret`，不要在聊天里粘贴，也不要提交到 GitHub。Google 的原生 OAuth 文档把令牌交换和刷新请求中的 `client_secret` 列为可选参数；当前先交 Client ID 即可，具体接入再按正确桌面流程核对，不把“JSON 里有 Secret”误当作“必须部署服务器”。[Google 原生应用令牌交换与刷新参数](https://developers.google.com/identity/protocols/oauth2/native-app)

正确的 Windows 授权集成会用系统浏览器，并通过电脑本机的 loopback 回调接回授权结果，端口由应用处理。你不必为此购买域名、部署网站或手工改 Windows 回调协议。[Google 桌面回调方式](https://developers.google.com/identity/protocols/oauth2/native-app)

**检查结果：**Clients 列表显示一条 `Desktop app` 类型的 `Readest Personal Windows`。

## 8. 创建 Android 客户端

继续使用同一个项目，不要给 Android 再建一套不同项目。

1. Clients → “创建客户端 / Create client”。
2. 按下表填写，点“创建 / Create”。

| 字段 | 怎么填 |
| --- | --- |
| 应用类型 / Application type | **Android** |
| 名称 / Name | `Readest Personal Android` |
| 软件包名称 / Package name | `com.bilingify.readest.personal` |
| SHA-1 证书指纹 / SHA-1 certificate fingerprint | `4A:5D:3F:F0:98:C9:C3:3B:FE:5E:C5:08:F6:7C:18:43:39:E0:91:A4` |

上述 SHA-1 来自本次私人版 APK 实际使用的固定签名证书，是公开指纹，不是签名密码。不要填 Windows 文件哈希、源码提交 ID、SHA-256 或临时 debug 证书。如果以后换签名证书，需要重新核对客户端；当前构建应继续用这套固定签名。[Google Android 客户端与签名配置](https://developer.android.com/identity/authorization)

如果出现“验证应用所有权 / Verify app ownership”，这是 Google Play 应用的可选验证；当前私人 APK 没有上传 Play，不需要为这个教程购买 Google Play 开发者账号。[OAuth 客户端类型官方说明](https://support.google.com/cloud/answer/15549257?hl=en)

创建后复制 Android 的 **Client ID**，标记为 Android。客户端 ID 与 Windows 那条不同是正常的。

**检查结果：**Clients 列表里有一条 Desktop app 和一条 Android；Android 详情的包名和 SHA-1 与表格完全一致。

Android 的正确源码集成会使用 Google 推荐的原生 `AuthorizationClient`，而不是沿用旧 iOS 客户端的自定义浏览器回调。该方式依赖可用的 Google Play services；如果手机没有 Google 服务，先把手机系统与 Google 服务情况告诉我，再确定适用的授权实现。这里的 Cloud 配置本身不能补上手机缺失的 Google 服务。[Android 授权官方说明](https://developer.android.com/identity/authorization)

本阶段先不额外创建 Web server 客户端；只有实现确实需要服务端授权时才补充对应配置，不把服务端 Client Secret 塞进 APK。

## 9. 完成后把两条 ID 发给我

可以按下面格式发来，使用你的真实 ID：

```text
Windows Client ID：……apps.googleusercontent.com
Android Client ID：……apps.googleusercontent.com
```

我会核对格式、接入各平台配置、更新 GitHub 构建设置，并生成带你自己配置的新 EXE 和 APK。账号登录与 Google 同意页面仍由你本人确认；你无需把密码、验证码、授权后的地址、refresh token 或下载的整份凭据 JSON 发给我。

Client ID 属于公开应用标识，通常会随安装包分发；它本身不能代替用户登录或授权。原生公开客户端与服务端私密客户端的秘密处理不同，应避免上传完整凭据文件。[Google 客户端与公开客户端说明](https://support.google.com/cloud/answer/15549257?hl=en)

### 可选：以后自己维护 GitHub 配置

一般由我完成这一步。你若以后自己操作：打开 [Pyongse/readest](https://github.com/Pyongse/readest) → Settings → Secrets and variables → Actions → Variables → New repository variable，按**完成平台授权适配后的构建说明**添加对应的公开 Client ID 变量；不要使用 Secrets 存放应用的访问令牌。

目前旧工作流只有单个 `GOOGLE_CLIENT_ID`，不能用它表达这次两个平台的配置。先等源码与工作流适配完成，变量名称以更新后的 `PERSONAL.md` 和工作流为准。之后在 Actions → Build Readest Personal → Run workflow，选择 `personal-drive` 分支运行；下载成功的两个平台产物。

## 10. 新包到手后的登录与同步验收

这些测试需要你在真实电脑、手机和 Google 账号上完成。Cloud 页面配置正确与同步已经可用是两个不同检查结果。

1. 安装重新构建的 **Readest Personal**，用独立的私人版书库目录；电脑和手机都使用同一 Google 账号。
2. 在应用“设置 → 集成 → Google Drive”连接。具体入口文字以新版界面为准。
3. Google 显示授权页时，检查是自己的项目，申请的权限是应用文件范围。确认自己创建的项目后授权。
4. 如果自己的 Testing 项目出现测试或未验证提示，先核对项目和账号；只对自己的项目按 Google 页面允许的流程继续。遇到“此应用已被阻止 / This app is blocked”不能当普通警告忽略。
5. 先用一本小 EPUB 测试：Windows 导入并同步，Android 刷新，能下载打开同一本书。
6. Windows 阅读到明显的位置并同步，Android 打开，检查进度。
7. Android 新建一个书签、一条标注和一条笔记，Windows 同步后逐项确认。
8. 两端彻底退出再启动，检查仍能同步；稍后再试一次，检查短期令牌更新。
9. 再测 PDF、离线后恢复联网，以及两端同时修改。若不能互见，不要删除云端书库，先保留报错和测试记录给我分析。

**通过标准：**两端登录成功、文件互见、进度一致、书签和笔记正确，重新打开后仍可同步。仅看到 Google 授权成功，不能算完成双端验证。

## 11. Testing 的 7 天问题与长期使用

因为本应用请求 `drive.file`，它不属于仅申请姓名、邮箱和头像的例外。Google 文档说明 External + Testing 的测试授权在 7 天后到期；若发放了 refresh token，它也会过期。测试阶段一周后需要重新连接，不一定是应用坏了。[Google 发布状态与 7 天授权规则](https://support.google.com/cloud/answer/15549945?hl=en)

完成双端测试后，可到 Audience 查看“发布应用 / Publish app”，考虑改成“In production / 正式发布”，然后重新授权。这个状态不会替你发布 APK、上架商店或公开书籍；它会扩大 Google 允许授权的受众，因此应在确认配置后再处理。

Google 对少于 100 名用户的个人使用应用列有 OAuth 验证例外；`drive.file` 本身也属于非敏感范围。但这不保证所有品牌信息、账号、发布条件和未来政策都免验证，也不保证令牌永不过期。是否出现额外验证要求，以控制台真实提示为准；不要为了省步骤谎填公司、域名或应用用途。[个人使用验证例外](https://support.google.com/cloud/answer/13464323?hl=en)、[Drive 非敏感权限](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

改成正式发布只能去掉“因 Testing 状态产生的 7 天限制”；撤销授权、长期不用、令牌数量限制或其他政策仍可能使登录失效。先重新连接并观察，再做长期测试。[Google 令牌过期原因](https://developers.google.com/identity/protocols/oauth2#expiration)

## 12. 常见问题

| 页面或现象 | 优先检查与处理 |
| --- | --- |
| `access_denied`，提示应用正在测试或账号没有访问权 | Audience → Test users 里是否有实际登录的邮箱；是否选错 Google 账号；用户主动取消授权也会出现同类错误 |
| `org_internal` | 是否误选 Internal；个人 Gmail 应按本指南使用 External |
| `redirect_uri_mismatch` | 客户端类型与程序回调是否匹配，是否还在用旧包。把报错页面的错误文字发给我，由我检查源码；不要随便新建 Web 客户端或填入官方 Readest 的回调 |
| `Custom URI scheme is not supported` / `invalid_request` | 旧 Android 自定义回调流程未正确替换；需要源码适配，不能靠更换客户端名称解决 |
| 授权页成功，随后 Drive 报 API 未启用 / `SERVICE_DISABLED` / `accessNotConfigured` | 检查启用 Drive API 的项目是否就是创建两个 Client ID 的项目；刚启用后稍等再试 |
| Android 提示开发者配置错误、签名或包名不匹配 | 核对 `com.bilingify.readest.personal` 与上面的 SHA-1；确认安装的是本次固定签名的私人版 APK |
| Android 提示 Google Play services 不可用 | 检查手机 Google 服务；把手机情况告诉我，不能通过添加 Cloud 范围修好设备服务 |
| 过了一周突然要求重新连接 / `invalid_grant` | 检查项目是否还在 External + Testing；也可能授权被撤销或令牌失效，先重新授权再定位 |
| 两端都登录成功，但看不到对方的书 | 检查账号、项目、实际安装包、同步开关；`drive.file` 不是全网盘权限。由我核对文件授权和同步行为，不要立即申请完整 Drive 权限 |
| `403 User rate limit exceeded` / `429` | 这是频率限制，先等待应用重试；不应通过购买 Readest 会员来解决 Google API 限制 |

Google 原生 OAuth 官方文档列有 `access_denied`、`invalid_request`、`redirect_uri_mismatch` 等错误及处理方向；Drive 配额文档说明 403/429 的限流含义。[OAuth 错误说明](https://developers.google.com/identity/protocols/oauth2/native-app)、[Drive 限流说明](https://developers.google.com/workspace/drive/api/guides/limits)

