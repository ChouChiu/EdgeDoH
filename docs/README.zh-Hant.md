<p align="center">
  <img src="icon-256.png" width="104" alt="cf-dns">
</p>

# cf-dns

<p align="center">
  <a href="../README.md">简体中文</a> · <b>繁體中文</b> · <a href="README.en.md">English</a>
</p>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChouChiu/cf-dns)

基於 Cloudflare Workers 免費層建構的個人專屬 DNS-over-HTTPS (DoH) 解析服務。支援依裝置分配獨立接入點、原生相容 AdGuard / hosts 過濾規則攔截廣告與追蹤、基於 Analytics Engine 記錄多維查詢統計，並提供完整的 Web 管理面板。

## 功能特性

- **DoH 解析**：遵循 RFC 8484 規範（支援 GET 與 POST），依裝置分配獨立接入點，提供 Apple 裝置描述檔（`.mobileconfig`）一鍵匯入。
- **規則過濾**：相容 AdGuard 過濾語法、標準 hosts 與純網域清單；內建 AdGuard 官方規則庫（HostlistsRegistry），支援自訂 URL 匯入與即時規則測試。快照在瀏覽器端非同步編譯為 64 位元雜湊分片，Worker 執行階段僅需記憶體二分搜尋；批次操作自動防抖合併編譯。
- **解析排程與快取**：支援依序容錯移轉與並行競速；整合 Cloudflare 邊緣 Cache API 與 TTL 區間收緊（Min/Max TTL）；提供多樣化攔截回應（0.0.0.0/::、NXDOMAIN、REFUSED、NODATA、自訂 IP）與 IPv6 快速降級（AAAA 回傳 NODATA）。
- **依裝置策略組**：每台裝置綁定一個策略組，分別選擇生效的過濾清單、攔截回應與上游；內建 AdGuard 封鎖服務目錄（TikTok、抖音、B 站、遊戲等）一鍵封鎖，支援依時區與星期的定時封鎖、強制安全搜尋（Google / Bing / DuckDuckGo）與 YouTube 嚴格篩選模式，並可暫時暫停單台裝置的過濾。
- **分流解析與 ECS**：依網域清單（相容 dnsmasq `server=/…/` 格式，如 dnsmasq-china-list）將指定網域交給專屬上游解析；可選擇向上游轉送用戶端 /24（IPv6 /56）子網（EDNS Client Subnet），讓 CDN 回傳就近節點，快取依子網隔離。
- **ECH 與 HTTP/3 注入**：對解析到 Cloudflare IP 段的網站，在 HTTPS 記錄中補上 `alpn=h3` 與 Cloudflare 公用 ECH 設定（取自 `cloudflare-ech.com`），網站本身未發布時自動合成；帶 DO 位元的查詢不做改寫。
- **本機記錄與請求來源**：在面板中直接維護 A / AAAA / CNAME 本機記錄（支援 `*.` 萬用字元）；日誌依 User-Agent 區分 DoH 用戶端（瀏覽器或系統解析器），依網域歸屬推斷所屬服務，並記錄來源網路（AS 組織）。DNS 請求本身不攜帶發起的 App，服務歸屬為推斷結果。
- **指標與日誌**：基於 Cloudflare Analytics Engine 記錄查詢量、攔截率、平均延遲與上游解析分佈；提供即時查詢日誌與多條件組合篩選，支援直接從日誌一鍵新增放行或攔截規則。
- **用戶端防濫用**：基於 Durable Objects 記錄滑動區間內的活躍網路（IPv4 依單 IP、IPv6 依 /64 網段），超額網路自動回應 REFUSED，防止專屬 DoH 位址外洩後被未授權網路利用。
- **零信任安全**：管理面板與 `/api/*` 受 Cloudflare Access (Zero Trust) JWT 驗證保護（Fail-closed）；DoH 解析流量走獨立路徑，不經過驗證。
- **Web 管理面板**：響應式單頁應用（Vite + React + Tailwind + shadcn/ui），適配行動端與深色模式；支援繁體中文、簡體中文與英文。

## 快速開始

開發環境依賴 [Bun](https://bun.sh) 與一個 Cloudflare 帳號：

```bash
bun install
cp wrangler.example.jsonc wrangler.jsonc
cp .env.example .env
echo ACCESS_DEV_BYPASS=true >> .env
bun run db:migrate:local
bun run dev
```

- `bun run dev` 基於 `@cloudflare/vite-plugin`，在 workerd 執行環境中與前端同源託管 API、DoH 與具 HMR 的管理面板（預設監聽 `http://localhost:8787`），無需預先建置。
- 本機 D1、KV 與 Durable Object 資料持久化儲存於 `.wrangler/state`。
- `.env` 中的 `ACCESS_DEV_BYPASS=true` 僅對發往 localhost / 127.0.0.1 的請求略過 Access JWT 驗證，線上環境切勿設定。
- `bun run build` 輸出面板靜態資產至 `dist/client` 與 Worker 成品至 `dist/cf_dns`；`bun run preview` 可在本機執行完整建置成品。
- `dig` 的 DoH 實作（`+https`）強制要求 HTTP/2，而 Vite 本機開發伺服器為 HTTP/1.1，本機偵錯請使用 `curl`、測試指令碼或瀏覽器進行驗證。

## 部署

詳細步驟請參閱 [部署指南](deploy.zh-Hant.md)，包含 Zero Trust 團隊與 Access 應用程式規則的設定說明。

- CLI 一鍵部署（推薦）：執行 `bun run setup`，指令碼會自動檢測或建立 D1 (`cf-dns`) 與 KV (`cf-dns-rules`) 並回寫 `wrangler.jsonc`，設定自訂網域與正式金鑰，執行 D1 遠端遷移並部署，支援安全重入。
- 一鍵部署按鈕：先在 Fork 出的儲存庫中提交一份由 `wrangler.example.jsonc` 複製的 `wrangler.jsonc`（資源 ID 留空），再點擊上方的 Deploy to Cloudflare 按鈕，資源由 Cloudflare 自動建立與綁定，部署完成後在 Worker 設定中透過建置變數 `CUSTOM_DOMAIN` 綁定網域。
- 日常更新：執行 `bun run deploy`，指令碼將依序執行建置、D1 遠端遷移與 Worker 部署。

`vite.config.ts` 會從環境變數或 `.env.deploy` 讀取 `CUSTOM_DOMAIN`。設定後將僅接聽該網域並關閉 `*.workers.dev`（因 workers.dev 網域下 Cache API 不生效，且在中國大陸地區無法正常存取）；未指定時預設使用 workers.dev。

## 設定與金鑰

敏感憑證與帳號資訊不納入版本控制。`wrangler.jsonc` 由 `wrangler.example.jsonc` 複製而來，帳號的 D1 與 KV 資源 ID 僅保存在本機；該檔案宣告基礎資源綁定與預設變數，並在 `secrets.required` 中宣告必需金鑰：

| 變數 | 作用域 | 說明 |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Worker 金鑰 | 保護管理面板與 `/api/*` 的 Access 團隊網域（如 `myteam.cloudflareaccess.com`） |
| `ACCESS_AUD` | Worker 金鑰 | 面板自託管應用的 Application Audience (AUD) 識別標籤 |
| `CF_ACCOUNT_ID` | Worker 金鑰 | 用於呼叫 Analytics Engine SQL API 的 Cloudflare 帳戶 ID |
| `STATS_API_TOKEN` | Worker 金鑰 | 具備 `Account > Account Analytics > Read` 權限的 API Token，留空則停用統計介面 |
| `ACCESS_DEV_BYPASS` | 本機環境變數 | 僅限本機開發，設為 `true` 時僅對 localhost 請求略過 Access，切勿寫入 `.env.production` |
| `CUSTOM_DOMAIN` | 建置環境變數 | 綁定的自訂網域，設定於 `.env.deploy` 或建置變數中，非 Worker 執行時期金鑰 |

- 設定範本為 `.env.example`，所有 `.env*` 檔案均已被 git 忽略。
- 本機開發讀取 `.env`，`wrangler dev` 會自動載入；若存在 `.dev.vars`，wrangler 會優先讀取，建議統一使用 `.env`。
- 線上部署讀取 `.env.production`（切勿包含 `ACCESS_DEV_BYPASS`），由 `bun run setup` 自動上傳；獨立更新金鑰可執行 `bun run secrets:push`（即 `wrangler secret bulk .env.production`）。
- `.env.deploy` 由 `bun run setup` 產生，記錄 `CUSTOM_DOMAIN` 與所選 `CLOUDFLARE_ACCOUNT_ID`，僅保存在本機。
- `wrangler secret bulk` 會覆蓋同名金鑰，未修改的項目請勿寫入 `.env.production`，避免覆蓋線上有效設定。
- Access 未設定時管理 API 回傳 503；統計憑證未設定時僅統計介面回傳 503；DoH 核心解析流程均不受任何影響。
- `wrangler.jsonc` 中的 `BLOCKING_MODE`、`BLOCKED_TTL`、`UPSTREAMS`、`UPSTREAM_TIMEOUT_MS` 僅為預設初始值，管理面板中修改的設定儲存在 D1 的 `settings` 資料表中並同步至 KV，各邊緣節點在 1 分鐘內自動熱更新。

## 解析流程

1. 裝置識別與設定載入：從請求路徑 `/dns-query/:deviceId` 讀取裝置識別碼。優先查詢 KV 執行階段設定快取，未命中時回退查詢 D1 資料庫；裝置不存在時直接回傳 404。
2. 來源網路頻控 (Client Guard)：若啟用網路數限制，提取用戶端 IP（`cf-connecting-ip`），由該裝置對應的 Durable Object 驗證時間區間內的活躍來源網路（IPv4 單 IP、IPv6 `/64` 網段）。超出上限回傳 REFUSED（標記 `source: limited`）。已放行網路在 isolate 記憶體中快取 5 分鐘以避免頻繁喚醒 Durable Object。
3. 本機記錄與 IPv6 降級：先比對面板中維護的本機記錄，命中即本機應答；未命中且開啟「停用 IPv6 解析」時，AAAA 查詢直接回傳 NODATA（NOERROR 且 Answer 為空），用戶端會立即回退至 IPv4。
4. 規則比對：裝置所屬策略組啟用過濾且裝置未暫停時，以目前規則快照比對網域（只啟用策略組選取的清單與封鎖服務，定時封鎖只在時間區間內生效），未命中再檢查安全搜尋與 YouTube 嚴格篩選模式：
   - 攔截：根據設定的回應模式（`null_ip` 回傳 0.0.0.0/::、`nxdomain`、`refused`、`nodata` 或 `custom_ip`）在本機建構並回傳 DNS 封包；
   - 改寫：命中 `$dnsrewrite` 或 hosts 項目時本機合成應答（若為 CNAME 則遞迴向上游解析目標網域並組合應答）；
   - 放行：命中白名單例外或未命中任何規則，進入上游解析；網域屬於已啟用的分流清單時改用該清單的上游。
5. 邊緣快取比對：基於 `qclass/qtype/小寫網域/DO/CD` 與上游集合（開啟 ECS 時再加用戶端子網）建構快取鍵，查詢 Cloudflare 邊緣 Cache API。命中時遞減 TTL，並回寫原始用戶端 Query ID 與大小寫格式後直接回傳。
6. 上游 DoH 請求：快取未命中時向設定的上游 DoH 節點發送 POST 請求（遵循 RFC 8484）：
   - 依序模式 (Fallback)：按順序請求，遇到網路錯誤、逾時或 SERVFAIL 時自動嘗試下一個節點；
   - 並行競速 (Parallel)：並行請求所有上游，採納首個非 SERVFAIL 的有效應答；
   - 全部失敗時回傳 SERVFAIL。
7. 快取回寫與 TTL 收緊：對有效回應（NOERROR 與 NXDOMAIN）按 RFC 2308 及設定的 TTL 上下限區間（Min/Max TTL）進行收緊，回寫至邊緣 Cache API，同時下發給用戶端。策略組開啟 ECH / HTTP/3 注入時，再改寫 Cloudflare 網站的 HTTPS 記錄。
8. 非同步指標上報：若啟用統計，透過 `ctx.waitUntil` 向 Analytics Engine 寫入一筆記錄（裝置、網域、類型、動作、延遲、上游、機房、DoH 用戶端類型與來源網路），不記錄用戶端 IP，也不阻塞回應。

## 來源網路上限

- 每台裝置綁定一個獨立的 SQLite 版 Durable Object（`DeviceClients`），記錄滑動區間內活躍的來源網路。IPv4 依單 IP 統計，IPv6 針對隱私擴充位址特性依 `/64` 子網路分組統計。
- 已放行的來源網路在目前 Worker isolate 記憶體中快取 5 分鐘，常規查詢無額外開銷；若 Durable Object 發生異常預設放行，確保解析高可用。
- 限制閥值與時間區間在面板設定頁「防濫用」中調整，設為 0 表示不限制；裝置卡片可即時檢視目前活躍網路數並支援手動重設。
- 未開啟 ECH / HTTP/3 注入時，HTTPS 記錄（Type 65）及其中的 ECH 設定原樣轉送。

## 規則引擎架構

Cloudflare Workers 免費層單請求 CPU 時間限制為 10ms，因此 Worker 從不即時解析原始文本規則，所有編譯工作均在前端瀏覽器（Web Worker）或 CLI 中完成：

- 精確網域規則（`||example.com^`、`|example.com^`、hosts、純網域）轉換為 64 位元雜湊有序表，查詢時透過二分搜尋比對目標網域及逐級父網域（$O(\log N)$）。
- 規則快照分散儲存在 32 個分片（Shards）中，主指標鍵 `snapshot:manifest:v3` 指向目前版本。Worker 節點每 30 秒輪詢一次版本指標，僅在查詢涉及未載入分片時依需求讀取並常駐記憶體。
- 萬用字元與正規表示式規則個別儲存（上限 5000 條），依必需字元標籤建立倒排索引，比對時依需求編譯執行；萬用字元使用分段字串比對，避免冷啟動時大量建構 RegExp 耗盡 CPU。
- 快照同步時僅推送 KV 中缺失的新分片，舊分片在下次版本提交時自動清除。
- 語法優先順序嚴格對齊 AdGuard 規範：`$dnsrewrite` > `@@...$important` > `...$important` > `@@...` (白名單) > 普通攔截規則。
- 修飾元支援：`$important`、`$badfilter`、`$dnstype`、`$client`（裝置名稱、裝置 ID、IP 或 CIDR）、`$denyallow`、`$dnsrewrite`（A、AAAA、CNAME 及 rcode 關鍵字）。hosts 項目設定非空 IP 自動識別為改寫。
- 自動過濾忽略：元素隱藏規則（cosmetic filters）、瀏覽器修飾元（如 `$ctag`）以及具備路徑或連接埠的規則在編譯時自動剔除並記錄在診斷報告中；`$dnstype` 僅針對查詢請求類型生效。

以 AdGuard DNS filter 規則庫（約 19 萬條）實測：前端 Web Worker 編譯僅需約 0.4 秒，編譯後總快照大小約 3 MB；線上熱節點 DoH 解析 CPU 耗時中位數約為 1ms，冷啟動首個請求約 12~22ms。

## 過濾清單管理

- 訂閱下載與解析：安裝或更新清單時，Worker 將規則原文串流寫入 KV，僅預讀前 16 KB 解析中繼資料（`Title`、`Description`、`Homepage`、`License`、`Version`、`Last modified`，相容 `!` 與 `#` 註解）。
- 本機非同步重新編譯：清單啟用、停用、更新、解除安裝或修改自訂規則時，瀏覽器在 Web Worker 中重新編譯所有已啟用的清單，上傳增量快照並回報有效規則數與語法診斷報告；多次操作自動防抖合併，避免並行衝突。
- 支援透過 `/install?url=<URL>&title=<名稱>` 外部連結直接喚起面板確認安裝對話方塊。

## 查詢統計與日誌

每次查詢向 Analytics Engine 寫入一個資料點（欄位結構定義見 `src/worker/features/stats/schema.ts`），以裝置 ID 為取樣鍵，不記錄用戶端具體 IP，資料預設保留 3 個月；可在設定中隨時關閉記錄。

- 統計介面透過 SQL API 查詢彙總，計數值依 `_sample_interval` 加權計算，查詢結果在目前機房邊緣快取 60 秒。
- 通用查詢參數支援 `range=1h|24h|7d|30d`（預設 24h）、`device`、`action=pass|allow|block|rewrite`、`source=upstream|cache|local|error|limited`、`search`（網域名稱搜尋，支援 `*` 萬用字元）。
- 前四個參數採用嚴格列舉白名單驗證，`search` 僅允許包含英數字與 `.-_*`。
- 免費層每天可寫入 10 萬個資料點，與 Workers 免費層每天 10 萬次請求相當。

## API 介面

所有 `/api/*` 請求均須攜帶有效的 Cloudflare Access JWT。介面異常統一回傳 `{ "error": "…" }`：

| 路徑 | 方法 | 說明 |
| --- | --- | --- |
| `/api/health` | `GET` | 服務健康檢查 |
| `/api/devices` | `GET`, `POST` | 取得裝置清單、建立新裝置 |
| `/api/devices/<ID>` | `PATCH`, `DELETE` | 修改裝置名稱或策略組、刪除裝置 |
| `/api/devices/<ID>/mobileconfig` | `GET` | 下載 Apple 裝置描述檔 |
| `/api/devices/<ID>/clients` | `GET`, `DELETE` | 查詢目前來源網路記錄、清空記錄 |
| `/api/devices/<ID>/pause` | `POST` | 暫停裝置過濾 `{ minutes }`，0 表示恢復 |
| `/api/rules` | `GET` | 取得目前規則快照中繼資料概況 |
| `/api/rules/manifest` | `GET` | 查詢已存在的分片清單 |
| `/api/rules/blobs/<hash>` | `PUT` | 上傳單一增量快照分片 |
| `/api/rules/commit` | `POST` | 提交並啟用新版本快照 |
| `/api/rules/snapshot` | `DELETE` | 停用目前規則快照 |
| `/api/rules/test` | `POST` | 模擬測試網域規則比對結果（參數：`name`, `type`, `deviceId`） |
| `/api/catalog` | `GET` | 取得 HostlistsRegistry 規則庫目錄 |
| `/api/lists` | `GET`, `POST` | 取得已安裝清單、新增清單 |
| `/api/lists/<ID>` | `PATCH`, `DELETE` | 修改清單狀態或名稱、解除安裝清單 |
| `/api/lists/<ID>/refresh` | `POST` | 手動拉取並更新指定清單原文 |
| `/api/lists/<ID>/text` | `GET`, `PUT` | 讀取清單在 KV 中的原文；替換手動輸入清單（如分流清單）的文字 |
| `/api/lists/reports` | `POST` | 用戶端回報編譯統計與語法診斷結果 |
| `/api/custom-rules` | `GET`, `PUT` | 讀取與儲存自訂規則文字 |
| `/api/settings` | `GET`, `PATCH` | 讀取與更新全域解析設定 |
| `/api/profiles` | `GET`, `POST` | 取得策略組清單、新增策略組 |
| `/api/profiles/<ID>` | `PATCH`, `DELETE` | 修改策略組、刪除策略組（預設策略組不可刪除） |
| `/api/services/:source` | `GET` | 服務目錄檔案（`adguard` 或 `community`，來自 [service-catalog](https://github.com/ChouChiu/service-catalog)） |
| `/api/local-records` | `GET`, `PUT` | 讀取與整體替換本機 DNS 記錄 |
| `/api/stats/summary` | `GET` | 查詢概覽統計指標（總量、攔截率、平均耗時等） |
| `/api/stats/timeseries` | `GET` | 取得查詢量與攔截量時序趨勢資料 |
| `/api/stats/top/<kind>` | `GET` | 排行榜統計（支援 `domains`, `blocked`, `devices`, `rules`, `lists`, `upstreams`, `services`, `clients`, `networks`） |
| `/api/stats/logs` | `GET` | 分頁查詢 DNS 請求日誌（支援 `limit` 與 `offset`） |

## CLI 命令列工具

專案提供獨立 CLI 工具，無需開啟管理面板即可完成規則編譯與快照上傳。`upload` 指令會自動讀取 Access Service Token（`CF_ACCESS_CLIENT_ID` 與 `CF_ACCESS_CLIENT_SECRET`），Bun 會自動載入目前目錄下的 `.env`：

```bash
# 編譯規則清單為本機二進位快照
bun run cli compile adguard=https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt -o snapshot

# 上傳並啟用快照
bun run cli upload snapshot --url https://dns.example.com
```

若未部署面板，亦可透過 wrangler 直接向 D1 寫入裝置資料：

```bash
bunx wrangler d1 execute DB --remote --command "INSERT INTO devices (id, name, created_at) VALUES ('<10位英數字ID>', '<裝置名稱>', <毫秒時間戳記>)"
```

## 目錄結構

程式碼庫位於單一 package 中，原始碼集中在 `src`，按執行環境嚴格分層並按功能模組組織：

```text
src/
├── lib/
│   ├── dns/       # 標準 DNS 封包編解碼，零執行時期依賴（別名 #dns）
│   ├── filter/    # 規則語法解析、編譯器、快照分片與比對引擎，跨環境共用（別名 #filter）
│   └── contract/  # Worker API 與面板共用的上限與列舉（別名 #contract）
├── worker/        # Cloudflare Worker 後端原始碼
│   ├── features/  # 業務模組（devices, doh, lists, profiles, records, rules, services, settings, stats），含 store、api 與單元測試
│   │   └── devices/client-guard.ts  # 來源網路頻控 Durable Object (DeviceClients)
│   ├── shared/    # Access JWT 驗證、KV 執行階段設定同步、HttpError、共用驗證與 SHA-256
│   └── test/      # 模擬上游、Analytics Engine SQL API 與測試輔助工具
├── web/           # 管理面板前端（Vite + React + Tailwind + shadcn/ui，別名 @/）
│   ├── app/       # 應用程式路由、導覽與全域版面配置
│   ├── features/  # 頁面與業務元件（devices, dns, filters, profiles, rules, settings, snapshot, stats）
│   ├── shared/    # shadcn UI 元件、共用 hooks、工具函式與 i18n 語言套件
│   └── test/      # 元件測試初始化
├── cli/           # 命令列工具（main.ts）與一鍵部署互動指令碼（setup.ts）
docs/              # 詳細部署與設定指南（含多語言 README）
migrations/        # D1 資料庫版本遷移指令碼
tsconfig/          # TypeScript 分層編譯配置（lib, worker, web, cli, node）
```

## 開發慣例與測試

執行程式碼檢查與完整測試套件：

```bash
bun run typecheck
bun run test
bun run build
```

- Worker 測試基於 `@cloudflare/vitest-plugin` 執行在真實 workerd 環境中；`src/lib` 與前端測試則執行在 Node 環境下（元件測試使用 happy-dom）；外部依賴透過 `src/worker/test/fake-upstream.ts` 完整模擬。
- API 路由內部一律擲出 `HttpError`，由頂層統一轉換為標準 JSON 錯誤格式。
- 語言套件位於 `src/web/shared/i18n/locales`，以 `zh-Hans.ts` 為基準鍵目錄，`zh-Hant.ts` 與 `en-US.ts` 透過 TypeScript 型別及 `locales.test.ts` 保持鍵名與參數預留位置一致。
- 換頁使用 React `<ViewTransition>`（基於 View Transitions API），切換路由時重設捲動位置。
- 所有資料表結構變更統一遞增存放在 `migrations` 目錄下，`bun run deploy` 部署時自動執行未套用的遠端遷移。

## 授權

[GNU AGPL v3](../LICENSE) 或任意更新版本。若你修改本專案並以網路服務形式提供給他人使用，須向其使用者提供對應的完整原始碼。
