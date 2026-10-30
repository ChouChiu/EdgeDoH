# 技术实现与架构设计

<div align="center">

**简体中文** · [繁體中文](TECHNICAL.zh-Hant.md) · [English](TECHNICAL.en.md)

</div>

本文档记录 EdgeDoH 的系统架构、核心解析流程、规则引擎设计、API 接口规格与开发约定。

## 架构总览

EdgeDoH 运行在 Cloudflare Workers 无服务器环境中，结合边缘存储与计算能力构建：

- **Cloudflare Worker (`src/worker`)**：核心运行环境。DoH 端点（`/dns-query/:deviceId`）独立处理二进制 DNS 报文，绕过路由框架开销；管理接口（`/api/*`）基于 Hono 提供 RESTful API 并受 Cloudflare Access JWT 保护。
- **D1 数据库 (`DB`)**：存储设备、过滤列表、策略组、本地 DNS 记录与全局配置等关系型数据。
- **KV 命名空间 (`RULES`)**：存储编译后的规则二进制快照分片、过滤列表原文与运行时配置镜像缓存。
- **Durable Objects (`DEVICE_CLIENTS`)**：基于 SQLite 存储跟踪每台设备在滑动时间窗口内的活跃来源网络（IPv4 单 IP，IPv6 `/64` 网段），执行接入防滥用控制。
- **Analytics Engine (`QUERY_LOG`)**：异步写入多维 DNS 查询日志与遥测指标，不阻塞解析链路。
- **Web 管理面板 (`src/web`)**：基于 Vite、React 19、Tailwind CSS v4 与 shadcn/ui 构建的响应式 SPA，规则快照直接在浏览器 Web Worker 中异步编译。
- **平台无关基础库 (`src/lib`)**：提供无平台依赖的标准 DNS 编解码器（`#dns`）、规则匹配引擎（`#filter`）与跨端契约常量（`#contract`）。

## 解析流水线

Worker 处理 DoH 请求（`/dns-query/:deviceId`）遵循以下执行顺序：

1. **设备识别与配置读取**：从 URL 路径获取设备 ID。优先读取 KV 中的运行时配置缓存（`config:v2`），未命中时回退查询 D1 数据库；设备不存在时直接响应 HTTP 404。若设备的策略组配置了定时规则并设置了「时段内改用策略组」，时段内整体改用目标策略组（只跟随一层；目标被删除时保持原策略组）。
2. **来源网络频控 (Client Guard)**：若策略启用了网络数限制，提取客户端 IP（`cf-connecting-ip`）。已验证的网络在 Worker 内存中缓存 5 分钟；新网络由设备对应的 Durable Object 校验滑动窗口内的活跃网络总数。超出上限返回 `REFUSED`（标记 `source: limited`）。若 Durable Object 异常，默认放行以保证高可用。
3. **本地记录与 IPv6 降级**：
   - 优先匹配面板中维护的本地 A / AAAA / CNAME 记录，命中即在边缘合成 DNS 响应返回。
   - 若策略组启用了「禁用 IPv6 解析」，对 AAAA 类型查询直接返回 `NODATA`（NOERROR 且 Answer 为空），客户端将快速回退至 IPv4。
4. **规则过滤与服务屏蔽**：当策略组启用过滤且设备未暂停时，使用当前规则快照二分查找匹配域名（仅执行策略组选中的列表与服务）：
   - **拦截**：根据配置的响应模式（`null_ip` 返回 0.0.0.0/::、`nxdomain`、`refused`、`nodata` 或 `custom_ip`）在本地构建 DNS 报文。
   - **改写**：命中 `$dnsrewrite` 或 hosts 规则时本地合成应答；若改写目标为 CNAME，递归向上游解析目标域名。
   - **放行**：命中白名单例外规则或未匹配任何拦截规则，进入上游解析流程。
   - 检查强制安全搜索（Google / Bing / DuckDuckGo）与 YouTube 受限模式。
5. **边缘缓存匹配**：基于 `qclass/qtype/域名小写/DO/CD`、当前上游集合及客户端子网（开启 ECS 时）生成缓存键，查询 Cloudflare 边缘 Cache API。命中时递减 TTL，还原原始客户端 Query ID 与大小写格式后直接返回。
6. **上游 DoH 查询**：缓存未命中时向配置的上游 DoH 发送 RFC 8484 POST 请求：
   - **顺序模式 (Fallback)**：按列表顺序请求，遭遇网络错误、超时或 SERVFAIL 时自动尝试下一个节点。
   - **并发竞速 (Parallel)**：并发向全部上游发起请求，采纳首个非 SERVFAIL 的有效响应。
   - 全面上游失败时返回 `SERVFAIL`。
7. **缓存写入与 TTL 收紧**：
   - 对有效响应（NOERROR 与 NXDOMAIN）根据 RFC 2308 及配置的 Min/Max TTL 范围进行收紧，写入边缘 Cache API 并响应客户端。
   - 若策略组启用了「DNS 重绑定防护」，A / AAAA 应答（含缓存命中）中出现本机、RFC 1918、链路本地或 IPv6 ULA 地址时，按拦截响应模式回应，日志记为拦截（列表 `rebinding`）。分流查询与白名单规则命中的域名不检查；运营商级 NAT 段 `100.64.0.0/10` 不在范围内。
   - 若策略组启用了 ECH 或 HTTP/3 注入，且目标域名解析至 Cloudflare 代理节点，向 HTTPS 记录注入 `alpn=h3` 与公共 ECH 参数（带 DO 位的 DNSSEC 查询不注入）。
8. **异步指标上报**：若启用日志，通过 `ctx.waitUntil` 向 Analytics Engine 写入结构化查询数据点（设备、域名、类型、动作、延迟、上游、数据中心、客户端类型、来源网络），不包含客户端具体 IP，不增加响应延迟。

## 规则引擎与快照分片

Cloudflare Workers 免费层单请求 CPU 时间限制为 10ms。EdgeDoH 避免在 Worker 运行时解析规则文本，编译过程全部移至浏览器 Web Worker 或 CLI：

### 分片存储机制
- **精确域名与后缀规则**：转换为 64 位哈希有序表，查询时通过二分查找匹配目标域名及逐级父域名，时间复杂度为 $O(\log N)$。
- **快照分片存储**：规则分散存储于 32 个分片（Shards）中，主指针键 `snapshot:manifest:v3` 记录当前版本元数据。Worker 节点每 30 秒校验一次版本指针，仅在查询涉及未加载分片时按需读取并常驻内存。
- **复杂规则索引**：包含通配符与正则的复杂规则单独存储（上限 5000 条），按必需字符标签建立倒排索引，匹配时按需执行，避免冷启动时批量构造 RegExp 消耗 CPU。
- **增量同步**：快照更新时前端仅向 KV 上传新增的分片哈希，提交新版本指针后自动清理失效的旧分片。

### 语法兼容与优先级
- 规则优先级遵循 AdGuard 规范：`$dnsrewrite` > `@@...$important` > `...$important` > `@@...` (白名单) > 普通拦截规则。
- 支持修饰符：`$important`、`$badfilter`、`$dnstype`、`$client`（设备名、设备 ID、IP 或 CIDR）、`$denyallow`、`$dnsrewrite`。
- 自动剔除规则：元素隐藏规则（cosmetic filters）、浏览器专用修饰符及包含 URL 路径或端口的规则在编译时自动过滤，并记录在诊断报告中。

## 来源网络防滥用 (Client Guard)

- 每台设备绑定一个独立的 Durable Object（`DeviceClients`），在 SQLite 中记录最近活跃的网络来源。
- IPv4 按单 IP 统计，IPv6 按 `/64` 子网聚合统计以兼容 SLAAC 隐私地址轮换。
- 已放行的来源网络在当前 Worker isolate 内存中缓存 5 分钟；常规查询无额外存储调用。
- 限制阈值与时间窗口在控制台「设置 → 防滥用」中调整，设为 0 表示不限制；设备卡片支持实时查看网络数并提供手动重置。

## 配置与密钥

运行时配置由 `wrangler.jsonc` 声明绑定与默认值，敏感密钥通过 Worker Secrets 管理：

| 变量名 | 作用域 | 说明 |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Worker Secret | 保护管理面板与 `/api/*` 的 Access 团队域名（如 `myteam.cloudflareaccess.com`） |
| `ACCESS_AUD` | Worker Secret | 面板自托管应用的 Application Audience (AUD) 标识 |
| `CF_ACCOUNT_ID` | Worker Secret | 用于调用 Analytics Engine SQL API 的 Cloudflare 账户 ID |
| `STATS_API_TOKEN` | Worker Secret | 具备 `Account > Account Analytics > Read` 权限的 API Token，留空停用统计查询 |
| `ACCESS_DEV_BYPASS` | 本地环境变量 | 仅限本地开发，设为 `true` 时对 localhost 请求跳过 Access JWT 验证，切勿配置到线上 |
| `CUSTOM_DOMAIN` | 构建环境变量 | 绑定的自定义域名，配置于 `.env.deploy` 或构建变量中，非运行时密钥 |

管理面板中修改的配置保存在 D1 的 `settings` 表中并镜像至 KV，各边缘节点在 1 分钟内自动热更新。

## API 接口参考

所有 `/api/*` 接口均需携带有效的 Cloudflare Access JWT。异常响应统一返回 `{ "error": "..." }`：

### 健康检查与设备
- `GET /api/health`：服务运行状态检查。
- `GET /api/devices`：获取设备列表。
- `POST /api/devices`：创建新设备，参数 `{ name, profileId? }`。
- `PATCH /api/devices/:id`：修改设备名称或绑定策略组。
- `DELETE /api/devices/:id`：删除指定设备。
- `GET /api/devices/:id/mobileconfig`：下载 Apple 设备描述文件。
- `GET /api/devices/:id/clients`：获取设备当前活跃来源网络。
- `DELETE /api/devices/:id/clients`：重置设备来源网络记录。
- `POST /api/devices/:id/pause`：暂停设备过滤，参数 `{ minutes }`（0 表示恢复）。
- `GET /api/devices/:id/rules` / `PUT /api/devices/:id/rules`：读取或全量替换设备规则 `[{ name, action }]`（`allow` / `block`，含子域名）。规则编译为始终生效的 `device-rules` 列表（`$client=<设备ID>,important`），不受策略组列表选择影响，保存后需重建快照。
- `GET /api/devices/rules`：全部设备规则，供快照编译使用。

### 规则快照与测试
- `GET /api/rules`：获取当前生效快照元数据。
- `GET /api/rules/manifest`：查询已存在的分片列表。
- `PUT /api/rules/blobs/:hash`：上传增量快照分片。
- `POST /api/rules/commit`：提交并激活新版本快照。
- `DELETE /api/rules/snapshot`：停用当前快照。
- `POST /api/rules/test`：模拟测试域名规则匹配结果，参数 `{ name, type, deviceId? }`。
- `GET /api/catalog`：获取官方规则库目录（HostlistsRegistry）。

### 过滤列表与自定义规则
- `GET /api/lists`：获取已安装的过滤列表。
- `POST /api/lists`：安装新过滤列表，参数 `{ url, name? }`。
- `PATCH /api/lists/:id`：修改列表启用状态或名称。
- `DELETE /api/lists/:id`：卸载过滤列表。
- `POST /api/lists/:id/refresh`：重新拉取远程列表内容。
- `GET /api/lists/:id/text`：读取列表原文。
- `PUT /api/lists/:id/text`：更新手动列表（如分流域名）内容。
- `POST /api/lists/reports`：客户端上报规则编译诊断报告。
- `GET /api/custom-rules`：获取自定义规则文本。
- `PUT /api/custom-rules`：更新自定义规则文本。

### 策略组、服务与分流
- `GET /api/profiles`：获取策略组列表。
- `POST /api/profiles`：创建新策略组。
- `PATCH /api/profiles/:id`：修改策略组配置。
- `DELETE /api/profiles/:id`：删除策略组（默认策略组不可删除）。
- `GET /api/services/:source`：获取服务目录（`adguard` 或 `community`）。
- `GET /api/local-records`：读取本地 DNS 记录。
- `PUT /api/local-records`：全量更新本地 DNS 记录。
- `GET /api/settings`：读取全局配置。
- `PATCH /api/settings`：更新全局配置。
- `GET /api/backup`：导出配置备份（设置、策略组、设备、列表、自定义规则、本地记录；不含设备 ID 与远程列表内容）。
- `PUT /api/backup`：用备份全量覆盖配置，设备获得新 ID；返回需重新下载的远程列表 `pending`。

### 查询统计与日志
- `GET /api/stats/summary`：概览指标（查询总量、拦截率、平均耗时等）。
- `GET /api/stats/timeseries`：时序趋势数据。
- `GET /api/stats/top/:kind`：排行榜数据（支持 `domains`, `blocked`, `devices`, `rules`, `lists`, `upstreams`, `services`, `clients`, `networks`）。
- `GET /api/stats/logs`：分页查询日志记录，支持 `limit`, `offset`, `search`, `range`, `device`, `action`, `source` 等过滤参数。

## CLI 命令行工具

项目在 `src/cli` 提供独立命令行工具，支持不打开 Web 面板执行离线编译与运维：

```bash
# 编译规则列表为本地二进制快照
bun run cli compile adguard=https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt -o snapshot

# 上传并激活快照（读取 .env 中的 Access Service Token）
bun run cli upload snapshot --url https://dns.example.com
```

若未部署面板，可通过 wrangler 直接操作 D1 数据库：

```bash
bunx wrangler d1 execute DB --remote --command "INSERT INTO devices (id, name, created_at) VALUES ('<10位ID>', '<设备名>', <时间戳>)"
```

## 目录结构

```text
src/
├── lib/           # 跨平台算法与协议编解码
│   ├── dns/       # 标准 DNS 报文编解码，零运行时依赖（别名 #dns）
│   ├── filter/    # 规则解析、快照编译与匹配引擎（别名 #filter）
│   └── contract/  # 前后端共用的限制常量与枚举（别名 #contract）
├── worker/        # Cloudflare Worker 后端源码
│   ├── features/  # 业务领域模块（devices, doh, lists, profiles, records, rules, services, settings, stats）
│   ├── shared/    # 鉴权中间件、配置同步、错误模型与通用校验
│   └── test/      # 上游 Mock 与测试辅助工具
├── web/           # 管理面板前端（Vite + React 19 + Tailwind CSS v4 + shadcn/ui）
│   ├── app/       # 路由与全局外框
│   ├── features/  # 业务视图组件
│   ├── shared/    # UI 基础组件、通用 hooks、工具函数与 i18n 资源
│   └── test/      # 单元测试环境配置
├── cli/           # 命令行工具与一键交互部署脚本
docs/              # 项目文档与部署指南
migrations/        # D1 关系型数据库结构迁移脚本
tsconfig/          # 分层 TypeScript 编译配置
```

## 验证与测试规范

提交代码前应在本地执行完整验证链：

```bash
bun run typecheck
bun run test
bun run build
```

- **类型检查**：`bun run typecheck` 先生成并校验 `worker-configuration.d.ts`，再执行分层 `tsc -b`。
- **自动化测试**：Worker 模块在真实 workerd 环境中运行（基于 `@cloudflare/vitest-plugin`），前端与算法测试在 Node / happy-dom 环境中运行。
- **生产构建**：`bun run build` 验证前端静态产物与 Worker 打包输出。
