# 部署指南

<div align="center">

**简体中文** · [繁體中文](deploy.zh-Hant.md) · [English](deploy.en.md)

</div>

EdgeDoH 提供两种部署方式：本地交互式一键部署脚本（推荐），或通过 GitHub 上的 Deploy to Cloudflare 按钮自动化部署。两种方式依赖的前置资源相同，部署前请先完成前置准备。

## 前置准备

### 1. 账号与域名规划

1. 准备一个 Cloudflare 账号（Workers 免费层即可满足个人与家庭日常需求）。
2. 准备一个已托管在当前 Cloudflare 账号下的根域名（如 `example.com`），解析服务将绑定在子域名上（如 `dns.example.com`）。
3. 无需提前创建子域名 DNS 记录，部署流程会自动分配并绑定。若此前已有同名 DNS 记录，请提前删除以避免冲突。
4. 关于 workers.dev 域名限制：Cloudflare 默认的 `*.workers.dev` 域名下 Cache API 不生效，且在中国大陆地区无法直接访问，强烈建议绑定独立自定义域名。
5. 获取账户 ID：登录 Cloudflare 控制台，在首页右下角复制「账户 ID」，或从浏览器地址栏提取（`dash.cloudflare.com/<账户ID>`）。

### 2. 初始化 Zero Trust 团队

管理面板与管理 API 全部受 Cloudflare Access (Zero Trust) 保护。若未配置鉴权凭据，Worker 将返回 HTTP 503 拒绝所有管理请求。

1. 访问 [Zero Trust 控制台](https://one.dash.cloudflare.com/)。首次使用按指引创建团队名称，计划选择 Free。
2. 进入「设置 → 自定义」，记录团队域名（格式通常为 `your-team.cloudflareaccess.com`），对应配置项 `ACCESS_TEAM_DOMAIN`。
3. 进入「设置 → 身份验证」，确保已启用至少一种登录认证方式（默认开启的邮箱一次性 PIN 验证码即可直接使用）。

### 3. 配置 Access 应用程序规则

进入「Access → 应用程序 → 添加应用程序 → 自托管」，以 `dns.example.com` 为例依次创建两个应用：

| 应用名称 | 路径 (Path) | 策略配置 | 说明 |
| --- | --- | --- | --- |
| `EdgeDoH 控制台` | 留空（保护全站） | 操作：`Allow`<br>规则包含：`Emails` 填入管理员邮箱 | 仅允许指定的邮箱登录面板并调用 `/api/*` |
| `EdgeDoH DoH` | `dns-query` | 操作：`Bypass`<br>规则包含：`Everyone` | 允许所有客户端直连 DoH 接口，绕过登录认证 |

Cloudflare Access 遵循最长前缀优先匹配原则。创建路径为 `dns-query` 的 Bypass 规则后，发往 `/dns-query` 及 `/dns-query/*` 的 DoH 查询请求都会直接放行，避免因重定向至登录页导致客户端解析失败。

创建完第一个面板应用后，进入该应用的「基本信息 (Overview)」，复制「应用程序受众 (AUD) 标记」，对应配置项 `ACCESS_AUD`。

### 4. 创建 Analytics Engine 统计凭据（可选）

若需要启用仪表盘中的查询分析、图表统计与日志功能，需要创建一个用于调用 Analytics Engine SQL API 的令牌：

1. 进入 Cloudflare 控制台「我的个人资料 → API 令牌 → 创建令牌 → 创建自定义令牌」。
2. 权限添加：`帐户 → 帐户分析 → 读取` (Account > Account Analytics > Read)。
3. 帐户资源选择「包含 → 指定账户（或所有账户）」。
4. 创建后复制生成的 Token 字符串，对应配置项 `STATS_API_TOKEN`。

若无需统计图表，此项可留空。此时仅面板内的统计页面不可用，核心 DNS 解析与广告拦截功能均不受影响。

### 5. 凭据清单汇总

部署前请确认已收集齐以下 4 项凭据：

| 变量名 | 获取途径 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Zero Trust 团队域名（第 2 步） |
| `ACCESS_AUD` | 面板 Access 应用的 AUD 标记（第 3 步） |
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID（第 1 步，交互脚本可自动获取） |
| `STATS_API_TOKEN` | 具有帐户分析读取权限的 API 令牌（第 4 步，选填） |

## 方式一：本地交互式一键部署（推荐）

依赖本地环境安装 [Bun](https://bun.sh) 与 `git`。

```bash
git clone https://github.com/ChouChiu/EdgeDoH.git
cd EdgeDoH
bun install
bun run setup
```

交互脚本将自动执行以下流程：

1. 检查 wrangler 登录状态，未登录时自动唤起浏览器授权；账号不止一个时提供序号选择。
2. 提示输入自定义域名（如 `dns.example.com`），配置保存至本地 `.env.deploy`。
3. 检查并自动创建 D1 数据库 (`edgedoh`) 与 KV 命名空间 (`edgedoh-rules`)，将生成的资源 ID 回写至 `wrangler.jsonc`（该文件不纳入版本控制，首次运行由 `wrangler.example.jsonc` 创建）。
4. 提示输入缺失的必需密钥，写入本地 `.env.production`。
5. 编译前端面板与 Worker，执行 D1 远程数据库迁移，并将凭据批量加密上传至 Worker 完成部署。

- 脚本支持多次执行，已创建的资源与已保存的凭据均会自动复用。
- 若需指定 D1 数据库物理位置，可在执行脚本前手动运行 `bunx wrangler d1 create edgedoh --location apac`，脚本将自动关联已有数据库。
- 后续更新代码并部署仅需执行：
  ```bash
  git pull && bun install && bun run deploy
  ```

## 方式二：Deploy to Cloudflare 按钮

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChouChiu/EdgeDoH)

> `wrangler.jsonc` 含账号资源 ID，不纳入版本控制。使用按钮前请先 Fork 本仓库，在 Fork 中提交一份由 `wrangler.example.jsonc` 复制的 `wrangler.jsonc`（D1 与 KV 的 ID 留空，由 Cloudflare 创建后回填），并把按钮链接中的 `url` 换成自己的仓库地址。

1. 点击按钮进入 Cloudflare Workers 快速部署流程，授权访问 GitHub，系统将自动把仓库 Fork 至个人 GitHub 账号下。
2. 页面将自动识别并列出需要创建的 D1、KV 与 Durable Object 资源绑定，保持默认配置即可。
3. 根据前置准备收集的信息填写 4 个环境变量密钥（`CF_ACCOUNT_ID` 需手动填写）。
4. 构建命令与部署命令均已预设（已包含 D1 远程迁移逻辑），保持默认并点击部署。
5. 部署完成后绑定自定义域名：
   - 进入 Worker 的「设置 → 构建 → 变量和机密」；
   - 添加构建变量：名称为 `CUSTOM_DOMAIN`，值为你的解析域名（例如 `dns.example.com`）；
   - 进入「部署」选项卡，点击重新构建（Retry deployment），完成域名绑定。
6. 后续只需向个人仓库的 `main` 分支推送提交，Cloudflare 将自动触发持续集成与重新部署。

请通过构建变量 `CUSTOM_DOMAIN` 绑定域名，避免在控制台「域和路由」中手动添加。手动绑定的自定义域不在 Worker 构建配置内，后续重新构建时可能会被覆盖。

## 部署后配置与验证

1. **登录控制台**：在浏览器中打开 `https://dns.example.com`，通过 Cloudflare Access 完成邮箱验证登录。
2. **添加设备**：进入「设备」页面点击「添加新设备」，获取专属的 DoH 接入点地址（格式为 `https://dns.example.com/dns-query/<设备ID>`）。Apple 平台用户可直接点击下载 `.mobileconfig` 描述文件。
3. **订阅规则列表**：进入「过滤列表」页面，点击「规则库目录」，挑选并安装常用规则列表（如 AdGuard DNS filter）。浏览器将在本地 Web Worker 中自动完成编译并将规则快照分片上传至边缘节点。
4. **解析链路验证**：使用命令行发送标准 RFC 8484 二进制 DNS 请求，确认收到二进制 DNS 应答报文：

```bash
curl -s -H 'accept: application/dns-message' \
  'https://dns.example.com/dns-query/<设备ID>?dns=q80BAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE' | xxd | head
```

## 常见问题排查

### 1. 部署报错 required secrets have not been set
首次部署缺少必需的环境变量。请确认 `.env.production` 中已填入 `ACCESS_TEAM_DOMAIN` 与 `ACCESS_AUD`，然后重新执行 `bun run setup` 或 `bun run secrets:push`。

### 2. 部署报错 10053 或 secret with the same name already exists
`ACCESS_DEV_BYPASS` 在 `wrangler.jsonc` 的 `vars` 字段中已声明为普通运行时变量。Cloudflare 规定普通变量与 Secret 不得同名，切勿将 `ACCESS_DEV_BYPASS` 写入 `.env.production` 或 Cloudflare 生产密钥中。

### 3. 面板或 API 请求返回 HTTP 503
说明 Worker 未读取到 `ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD` 凭据。请在 `.env.production` 中补齐并运行 `bun run secrets:push`。若仅统计分析页面返回 503，说明 `STATS_API_TOKEN` 未配置或权限不正确。

### 4. API 请求返回 HTTP 401
请求未携带有效的 Cloudflare Access JWT 令牌。通常是因为访问的主机名未包含在 Access 应用程序保护范围内，导致请求未经过 Access 网关注入认证 Header。

### 5. API 请求返回 HTTP 403
Access JWT 令牌验证失败。请核对 Worker 的 `ACCESS_AUD` 密钥是否与保护该域名的 Access 应用程序中的 AUD 完全一致，并确认 `ACCESS_TEAM_DOMAIN` 团队域名无拼写错误。

### 6. 客户端无法解析 DNS 或收到 HTML 响应
说明缺少路径为 `dns-query` 的 Access Bypass 应用程序，导致客户端发起的 DNS 查询被拦截并重定向到了 Access 网页登录页面。请检查前置准备第 3 步中的两条 Access 策略配置。

### 7. 自定义域名无法绑定
确认该域名已添加至当前 Cloudflare 账号且处于活跃状态；同时检查该子域名是否已存在同名的 A/AAAA/CNAME 解析记录，如有请先删除。

### 8. 统计页面显示无数据或查询报错
- 新部署的实例需要等待产生实际 DNS 解析请求后，Analytics Engine 才会采集到指标数据。
- 确认 `STATS_API_TOKEN` 具有「帐户分析 > 读取」权限，且配置的 `CF_ACCOUNT_ID` 与该 Token 所属账号严格对应。
