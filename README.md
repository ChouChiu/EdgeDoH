<p align="center">
  <img src="docs/icon-256.png" width="104" alt="cf-dns">
</p>

# cf-dns

<p align="center">
  <b>简体中文</b> · <a href="docs/README.zh-Hant.md">繁體中文</a> · <a href="docs/README.en.md">English</a>
</p>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChouChiu/cf-dns)

基于 Cloudflare Workers 免费层构建的个人专属 DNS-over-HTTPS (DoH) 解析服务。支持按设备分配独立接入点、原生兼容 AdGuard / hosts 过滤规则拦截广告与追踪、基于 Analytics Engine 记录多维查询统计，并提供完整的 Web 管理面板。

## 功能特性

- **DoH 解析**：遵循 RFC 8484 规范（支持 GET / POST），按设备分配独立接入点，提供 Apple 设备描述文件（`.mobileconfig`）一键导入。
- **规则过滤**：兼容 AdGuard 过滤语法、标准 hosts 与纯域名列表；内置 AdGuard 官方规则库（HostlistsRegistry），支持自定义 URL 导入与实时规则测试。快照在浏览器端异步编译为 64 位哈希分片，Worker 运行时仅需内存二分查找；批量操作自动防抖合并编译。
- **解析调度与缓存**：支持顺序故障转移与并发竞速；集成 Cloudflare 边缘 Cache API 与 TTL 区间收紧（Min/Max TTL）；提供多样化拦截响应（0.0.0.0/::、NXDOMAIN、REFUSED、NODATA、自定义 IP）与 IPv6 快速降级（AAAA 返回 NODATA）。
- **按设备策略组**：每台设备绑定一个策略组，分别选择生效的过滤列表、拦截响应与上游；内置 AdGuard 屏蔽服务目录（TikTok、抖音、B 站、游戏等）一键屏蔽，支持按时区与星期的定时屏蔽、强制安全搜索（Google / Bing / DuckDuckGo）与 YouTube 受限模式，并可临时暂停单台设备的过滤。
- **分流解析与 ECS**：按域名列表（兼容 dnsmasq `server=/…/` 格式，如 dnsmasq-china-list）把指定域名交给专属上游解析；可选向上游转发客户端 /24（IPv6 /56）子网（EDNS Client Subnet），让 CDN 返回就近节点，缓存按子网隔离。
- **ECH 与 HTTP/3 注入**：对解析到 Cloudflare IP 段的站点，在 HTTPS 记录中补充 `alpn=h3` 与 Cloudflare 公共 ECH 配置（取自 `cloudflare-ech.com`），站点自身未发布时自动合成；带 DO 位的查询不做改写。
- **本地记录与请求来源**：面板中直接维护 A / AAAA / CNAME 本地记录（支持 `*.` 通配）；日志按 User-Agent 区分 DoH 客户端（浏览器或系统解析器），按域名归属推断所属服务，并记录来源网络（AS 组织）。DNS 请求本身不携带发起的 App，服务归属为推断结果。
- **指标与日志**：基于 Cloudflare Analytics Engine 记录查询量、拦截率、平均延迟与上游解析分布；提供实时查询日志与多条件组合筛选，支持直接从日志一键添加放行或拦截规则。
- **客户端防滥用**：基于 Durable Objects 记录滑动窗口内的活跃网络（IPv4 按单 IP、IPv6 按 /64 网段），超额网络自动响应 REFUSED，防止专属 DoH 地址泄漏后被未授权网络利用。
- **零信任安全**：管理面板与 `/api/*` 受 Cloudflare Access (Zero Trust) JWT 校验保护（Fail-closed）；DoH 解析流量走独立路径，零鉴权冗余开销。
- **Web 管理面板**：响应式单页应用（Vite + React + Tailwind + shadcn/ui），深度适配移动端与暗色模式；支持简体中文、繁体中文与英文；基于 View Transitions API 提供平滑页面过渡与主题动效。

## 快速开始

开发环境依赖 [Bun](https://bun.sh) 与一个 Cloudflare 账号：

```bash
bun install
cp wrangler.example.jsonc wrangler.jsonc
cp .env.example .env
echo ACCESS_DEV_BYPASS=true >> .env
bun run db:migrate:local
bun run dev
```

- `bun run dev` 基于 `@cloudflare/vite-plugin`，在 workerd 运行时中与前端同源托管 API、DoH 与带 HMR 的管理面板（默认监听 `http://localhost:8787`），无需预先构建。
- 本地 D1、KV 与 Durable Object 数据持久化存储于 `.wrangler/state`。
- `.env` 中的 `ACCESS_DEV_BYPASS=true` 仅对发往 localhost / 127.0.0.1 的请求跳过 Access JWT 验证，线上环境切勿配置。
- `bun run build` 输出面板静态资源至 `dist/client` 与 Worker 产物至 `dist/cf_dns`；`bun run preview` 可在本地运行完整构建产物。
- `dig` 的 DoH 实现（`+https`）强制要求 HTTP/2，而 Vite 本地开发服务器为 HTTP/1.1，本地调试请使用 `curl`、测试脚本或浏览器进行验证。

## 部署

详细步骤可查阅 [部署指南](docs/deploy.md)，包含 Zero Trust 团队与 Access 应用程序规则的配置说明。

- CLI 一键部署（推荐）：运行 `bun run setup`，脚本会自动检测或创建 D1 (`cf-dns`) 与 KV (`cf-dns-rules`) 并回写 `wrangler.jsonc`，配置自定义域名与生产密钥，执行 D1 远程迁移并部署，支持安全重入。
- 一键部署按钮：先在 Fork 出的仓库中提交一份由 `wrangler.example.jsonc` 复制的 `wrangler.jsonc`（资源 ID 留空），再点击上方的 Deploy to Cloudflare 按钮，资源由 Cloudflare 自动创建与绑定，部署完成后在 Worker 设置中通过构建变量 `CUSTOM_DOMAIN` 绑定域名。
- 日常更新：运行 `bun run deploy`，脚本依次执行构建、D1 远程迁移与 Worker 部署。

`vite.config.ts` 会从环境变量或 `.env.deploy` 读取 `CUSTOM_DOMAIN`。配置后将仅监听该域名并关闭 `*.workers.dev`（因 workers.dev 域名下 Cache API 不生效，且在中国大陆地区无法正常访问）；未指定时默认使用 workers.dev。

## 配置与密钥

敏感凭据与账号信息不进入版本控制。`wrangler.jsonc` 由 `wrangler.example.jsonc` 复制而来，账号的 D1 与 KV 资源 ID 仅保存在本地；该文件声明基础资源绑定与默认变量，并在 `secrets.required` 中声明必需密钥：

| 变量 | 作用域 | 说明 |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Worker 密钥 | 保护管理面板与 `/api/*` 的 Access 团队域名（如 `myteam.cloudflareaccess.com`） |
| `ACCESS_AUD` | Worker 密钥 | 面板自托管应用的 Application Audience (AUD) 标识 |
| `CF_ACCOUNT_ID` | Worker 密钥 | 用于调用 Analytics Engine SQL API 的 Cloudflare 账户 ID |
| `STATS_API_TOKEN` | Worker 密钥 | 拥有 `Account > Account Analytics > Read` 权限的 API Token，留空则停用统计接口 |
| `ACCESS_DEV_BYPASS` | 本地环境变量 | 仅限本地开发，设为 `true` 时仅对 localhost 请求跳过 Access，切勿写入 `.env.production` |
| `CUSTOM_DOMAIN` | 构建环境变量 | 绑定的自定义域名，配置于 `.env.deploy` 或构建变量中，非 Worker 运行时密钥 |

- 配置模板为 `.env.example`，所有 `.env*` 文件均已被 git 忽略。
- 本地开发读取 `.env`，`wrangler dev` 会自动加载；若存在 `.dev.vars`，wrangler 会优先读取，建议统一使用 `.env`。
- 线上部署读取 `.env.production`（切勿包含 `ACCESS_DEV_BYPASS`），由 `bun run setup` 自动上传；独立更新密钥可执行 `bun run secrets:push`（即 `wrangler secret bulk .env.production`）。
- `.env.deploy` 由 `bun run setup` 生成，记录 `CUSTOM_DOMAIN` 与所选 `CLOUDFLARE_ACCOUNT_ID`，仅保存在本地。
- `wrangler secret bulk` 会覆盖同名密钥，未修改的项请勿写入 `.env.production`，避免覆盖线上有效配置。
- Access 未配置时管理 API 返回 503；统计凭据未配置时仅统计接口返回 503；DoH 核心解析流程均不受任何影响。
- `wrangler.jsonc` 中的 `BLOCKING_MODE`、`BLOCKED_TTL`、`UPSTREAMS`、`UPSTREAM_TIMEOUT_MS` 仅为默认初始值，管理面板中修改的配置保存在 D1 的 `settings` 表中并镜像至 KV，各边缘节点在 1 分钟内自动热更新。

## 解析流水线

1. 设备路由与配置加载：从请求路径 `/dns-query/:deviceId` 读取设备标识。优先查询 KV 运行时配置镜像，未命中时回退查询 D1 数据库；设备不存在时直接返回 404。
2. 来源网络频控 (Client Guard)：若启用网络数限制，提取客户端 IP（`cf-connecting-ip`），由该设备对应的 Durable Object 校验时间窗口内的活跃来源网络（IPv4 单 IP、IPv6 `/64` 网段）。超出上限返回 REFUSED（标记 `source: limited`）。已放行网络在 isolate 内存中缓存 5 分钟以避免频繁唤醒 Durable Object。
3. IPv6 降级：若开启「禁用 IPv6 解析」，针对 AAAA 查询直接返回 NODATA 空应答（NOERROR 且 Answer 为空），引导客户端立即回退至 IPv4。
4. 规则引擎匹配：若启用过滤，基于当前版本的规则快照执行域名及修饰符匹配：
   - 拦截：根据配置的响应模式（`null_ip` 返回 0.0.0.0/::、`nxdomain`、`refused`、`nodata` 或 `custom_ip`）在本地构建并返回 DNS 报文；
   - 改写：命中 `$dnsrewrite` 或 hosts 条目时本地合成应答（若为 CNAME 则递归向上游解析目标域名并组装应答）；
   - 放行：命中白名单例外规则或未命中拦截规则，进入上游解析流程。
5. 边缘缓存匹配：基于 `qclass/qtype/小写域名/DO/CD` 构造缓存键，查询 Cloudflare 边缘 Cache API。命中时递减 TTL，并回写原始客户端 Query ID 与大小写格式后直接返回。
6. 上游 DoH 请求：缓存未命中时向配置的上游 DoH 节点发送 POST 请求（遵循 RFC 8484）：
   - 顺序模式 (Fallback)：按顺序请求，遇到网络错误、超时或 SERVFAIL 时自动尝试下一个节点；
   - 并行竞速 (Parallel)：并发请求所有上游，采纳首个非 SERVFAIL 的有效应答；
   - 全部失败时返回 SERVFAIL。
7. 缓存回写与 TTL 收紧：对有效响应（NOERROR 与 NXDOMAIN）按 RFC 2308 及设置的 TTL 上下限区间（Min/Max TTL）进行收紧，回写至边缘 Cache API，同时下发给客户端。
8. 异步指标上报：若启用统计，通过 `ctx.waitUntil` 异步向 Analytics Engine 写入查询指标（不记录具体客户端 IP，仅保留设备 ID、查询域名、记录类型、拦截动作、延迟及上游节点），零阻塞下发响应。

## 来源网络上限

- 每台设备绑定一个独立的 SQLite 版 Durable Object（`DeviceClients`），记录滑动窗口内活跃的来源网络。IPv4 按独立 IP 统计，IPv6 针对隐私扩展地址特性按 `/64` 子网聚类统计。
- 已放行的来源网络在当前 Worker isolate 内存中缓存 5 分钟，常规查询无额外开销；若 Durable Object 发生异常默认放行，确保解析高可用。
- 限制阈值与时间窗口在面板设置页「防滥用」中调整，设为 0 表示不限制；设备卡片可实时查看当前活跃网络数并支持手动重置。
- HTTPS 记录（Type 65）及其中的 ECH (Encrypted Client Hello) 配置均原样透明转发，支持 ECH 的客户端在安全 DNS 下可自动建立加密握手。

## 规则引擎架构

Cloudflare Workers 免费层单请求 CPU 时间限制为 10ms，因此 Worker 从不实时解析原始文本规则，所有编译工作均在前端浏览器（Web Worker）或 CLI 中完成：

- 精确域名规则（`||example.com^`、`|example.com^`、hosts、纯域名）转换为 64 位哈希有序表，查询时通过二分查找匹配目标域名及逐级父域（$O(\log N)$）。
- 规则快照分散存储在 32 个分片（Shards）中，主指针键 `snapshot:manifest:v3` 指向当前版本。Worker 节点每 30 秒轮询一次版本指针，仅在查询涉及未加载分片时按需读取并常驻内存。
- 通配符与正则规则单独存储（上限 5000 条），按必需字符标签建立倒排索引，匹配时按需编译执行；通配符使用分段字符串匹配，避免冷启动时大量构造 RegExp 耗尽 CPU。
- 快照同步时仅推送 KV 中缺失的新分片，旧分片在下次版本提交时自动清理。
- 语法优先级严格对齐 AdGuard 规范：`$dnsrewrite` > `@@...$important` > `...$important` > `@@...` (白名单) > 普通拦截规则。
- 修饰符支持：`$important`、`$badfilter`、`$dnstype`、`$client`（设备名称、设备 ID、IP 或 CIDR）、`$denyallow`、`$dnsrewrite`（A、AAAA、CNAME 及 rcode 关键字）。hosts 条目配置非空 IP 自动识别为改写。
- 自动过滤忽略：元素隐藏规则（cosmetic filters）、浏览器修饰符（如 `$ctag`）以及带路径或端口的规则在编译时自动剔除并记录在诊断报告中；`$dnstype` 仅针对查询请求类型生效。

以 AdGuard DNS filter 规则库（约 19 万条）实测：前端 Web Worker 编译仅需约 0.4 秒，编译后总快照体积约 3 MB；线上热节点 DoH 解析 CPU 耗时中位数约为 1ms，冷启动首请求约 12~22ms。

## 过滤列表管理

- 安装或更新列表时，Worker 将规则原文流式写入 KV，仅预读前 16 KB 解析元数据（`Title`、`Description`、`Homepage`、`License`、`Version`、`Last modified`，兼容 `!` 与 `#` 注释）。
- 列表启用、停用、更新、卸载或修改自定义规则时，浏览器在 Web Worker 中重新编译所有已启用的列表，上传增量快照并上报有效规则数与语法诊断报告；多次操作自动防抖合并，避免并发冲突。
- 支持通过 `/install?url=<URL>&title=<名称>` 外部链接直接调起面板确认安装对话框。

## 查询统计与日志

每次查询向 Analytics Engine 写入一个数据点（列结构定义见 `src/worker/features/stats/schema.ts`），以设备 ID 为采样键，不记录客户端具体 IP，数据默认保留 3 个月；可在设置中随时关闭记录。

- 统计接口通过 SQL API 查询汇总，计数值按 `_sample_interval` 加权计算，查询结果在当前机房边缘缓存 60 秒。
- 通用查询参数支持 `range=1h|24h|7d|30d`（默认 24h）、`device`、`action=pass|allow|block|rewrite`、`source=upstream|cache|local|error|limited`、`search`（域名模糊搜索，支持 `*` 通配符）。
- 前四个参数采用严格枚举白名单校验，`search` 仅允许包含字母、数字与 `.-_*`。
- 每天支持写入 10 万个数据点（与每天 10 万次 Worker 免费请求完全对齐），每月支持充分的 SQL 读取额度。

## API 接口

所有 `/api/*` 请求均须携带有效的 Cloudflare Access JWT。接口异常统一返回 `{ "error": "…" }`：

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/api/health` | `GET` | 服务健康检查 |
| `/api/devices` | `GET`, `POST` | 获取设备列表、创建新设备 |
| `/api/devices/<ID>` | `PATCH`, `DELETE` | 修改设备名称或策略组、删除设备 |
| `/api/devices/<ID>/mobileconfig` | `GET` | 下载 Apple 设备描述文件 |
| `/api/devices/<ID>/clients` | `GET`, `DELETE` | 查询当前来源网络记录、清空记录 |
| `/api/rules` | `GET` | 获取当前规则快照元数据概况 |
| `/api/rules/manifest` | `GET` | 查询已存在的分片列表 |
| `/api/rules/blobs/<hash>` | `PUT` | 上传单个增量快照分片 |
| `/api/rules/commit` | `POST` | 提交并激活新版本快照 |
| `/api/rules/snapshot` | `DELETE` | 停用当前规则快照 |
| `/api/rules/test` | `POST` | 模拟测试域名规则匹配结果（参数：`name`, `type`, `deviceId`） |
| `/api/catalog` | `GET` | 获取 HostlistsRegistry 规则库目录 |
| `/api/lists` | `GET`, `POST` | 获取已安装列表、添加新列表 |
| `/api/lists/<ID>` | `PATCH`, `DELETE` | 修改列表状态或名称、卸载列表 |
| `/api/lists/<ID>/refresh` | `POST` | 手动拉取并更新指定列表原文 |
| `/api/lists/<ID>/text` | `GET` | 读取指定列表在 KV 中的原始文本 |
| `/api/lists/reports` | `POST` | 客户端上报编译统计与语法诊断结果 |
| `/api/custom-rules` | `GET`, `PUT` | 读取与保存自定义规则文本 |
| `/api/settings` | `GET`, `PATCH` | 读取与更新全局解析设置 |
| `/api/profiles` | `GET`, `POST` | 获取策略组列表、新建策略组 |
| `/api/profiles/<ID>` | `PATCH`, `DELETE` | 修改策略组、删除策略组（默认策略组不可删除） |
| `/api/devices/<ID>/pause` | `POST` | 暂停设备过滤 `{ minutes }`，0 表示恢复 |
| `/api/services` | `GET` | 获取 AdGuard 屏蔽服务目录（含规则与图标） |
| `/api/local-records` | `GET`, `PUT` | 读取与整体替换本地 DNS 记录 |
| `/api/lists/<ID>/text` | `PUT` | 替换手动输入列表（如分流列表）的文本 |
| `/api/stats/summary` | `GET` | 查询概览统计指标（总量、拦截率、平均耗时等） |
| `/api/stats/timeseries` | `GET` | 获取查询量与拦截量时序趋势数据 |
| `/api/stats/top/<kind>` | `GET` | 排行榜统计（支持 `domains`, `blocked`, `devices`, `rules`, `lists`, `upstreams`） |
| `/api/stats/logs` | `GET` | 分页查询 DNS 请求日志（支持 `limit` 与 `offset`） |

## CLI 命令行工具

项目提供独立 CLI 工具，无需打开管理面板即可完成规则编译与快照上传。`upload` 命令会自动读取 Access Service Token（`CF_ACCESS_CLIENT_ID` 与 `CF_ACCESS_CLIENT_SECRET`），Bun 会自动加载当前目录下的 `.env`：

```bash
# 编译规则列表为本地二进制快照
bun run cli compile adguard=https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt -o snapshot

# 上传并激活快照
bun run cli upload snapshot --url https://dns.example.com
```

若未部署面板，亦可通过 wrangler 直接向 D1 插入设备数据：

```bash
bunx wrangler d1 execute DB --remote --command "INSERT INTO devices (id, name, created_at) VALUES ('<10位字母数字ID>', '<设备名称>', <毫秒时间戳>)"
```

## 目录结构

代码库位于单个 package 中，源码集中在 `src`，按运行环境严格分层并按功能模块组织：

```text
src/
├── lib/
│   ├── dns/       # 标准 DNS 报文编解码，零运行时依赖（别名 #dns）
│   └── filter/    # 规则语法解析、编译器、快照分片与匹配引擎，跨环境共用（别名 #filter）
├── worker/        # Cloudflare Worker 后端源码
│   ├── features/  # 业务模块（devices, doh, lists, rules, settings, stats），含 store、api 与单元测试
│   │   └── devices/client-guard.ts  # 来源网络频控 Durable Object (DeviceClients)
│   ├── shared/    # Access JWT 鉴权、KV 运行时配置同步、HttpError 封装与 SHA-256
│   └── test/      # 模拟上游、Analytics Engine SQL API 与测试辅助工具
├── web/           # 管理面板前端（Vite + React + Tailwind + shadcn/ui，别名 @/）
│   ├── app/       # 应用路由、导航与全局布局
│   ├── features/  # 页面与业务组件（stats, filters, rules, snapshot, devices, settings）
│   └── shared/    # shadcn UI 组件、通用 hooks、工具函数与 i18n 语言包
├── cli/           # 命令行工具（main.ts）与一键部署交互脚本（setup.ts）
docs/              # 详细部署与配置指南（含多语言 README）
migrations/        # D1 数据库版本迁移脚本
tsconfig/          # TypeScript 分层编译配置（lib, worker, web, cli, node）
```

## 开发约定与测试

运行代码检查与完整测试套件：

```bash
bun run test
bun run typecheck
```

- Worker 测试基于 `@cloudflare/vitest-plugin` 运行在真实 workerd 环境中；`src/lib` 与前端测试则运行在 Node 环境下；外部依赖通过 `src/worker/test/fake-upstream.ts` 完整模拟。
- API 路由内部一律抛出 `HttpError`，由顶层统一转换为标准 JSON 错误格式。
- 语言包位于 `src/web/shared/i18n/locales`，以 `zh-Hans.ts` 为基准键目录，`zh-Hant.ts` 与 `en-US.ts` 通过 TypeScript 类型及 `locales.test.ts` 保持键名与参数占位符的 100% 严格一致。
- 切页与主题切换均深度集成 View Transitions API；页面路由切换时自动重置滚动位置；桌面端导航仅淡入更新正文内容，侧边栏保持平稳无闪烁。
- 所有数据表结构变更统一递增存放在 `migrations` 目录下，`bun run deploy` 部署时自动执行未应用的远程迁移。

## 许可证

[GNU AGPL v3](LICENSE) 或任意更新版本。若你修改本项目并以网络服务形式提供给他人使用，须向其用户提供对应的完整源代码。
