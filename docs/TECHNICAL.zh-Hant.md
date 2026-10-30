# 技術實作與架構設計

<div align="center">

[简体中文](TECHNICAL.md) · **繁體中文** · [English](TECHNICAL.en.md)

</div>

本文件記錄 EdgeDoH 的系統架構、核心解析流程、規則引擎設計、API 介面規格與開發約定。

## 架構總覽

EdgeDoH 運行於 Cloudflare Workers 無伺服器環境中，結合邊緣儲存與運算能力建構：

- **Cloudflare Worker (`src/worker`)**：核心執行環境。DoH 端點（`/dns-query/:deviceId`）獨立處理二進位 DNS 封包，略過路由框架開銷；管理介面（`/api/*`）基於 Hono 提供 RESTful API 並受 Cloudflare Access JWT 保護。
- **D1 資料庫 (`DB`)**：儲存裝置、過濾清單、策略組、本機 DNS 記錄與全域設定等關聯式資料。
- **KV 命名空間 (`RULES`)**：儲存編譯後的規則二進位快照分片、過濾清單原文與執行階段設定快取。
- **Durable Objects (`DEVICE_CLIENTS`)**：基於 SQLite 儲存追蹤每台裝置在滑動時間區間內的活躍來源網路（IPv4 單 IP，IPv6 `/64` 網段），執行存取防濫用控制。
- **Analytics Engine (`QUERY_LOG`)**：非同步寫入多維 DNS 查詢記錄與遙測指標，不阻塞解析流程。
- **Web 管理面板 (`src/web`)**：基於 Vite、React 19、Tailwind CSS v4 與 shadcn/ui 建構的響應式 SPA，規則快照直接在瀏覽器 Web Worker 中非同步編譯。
- **跨平台基礎庫 (`src/lib`)**：提供無平台依賴的標準 DNS 編解碼器（`#dns`）、規則比對引擎（`#filter`）與跨端契約常數（`#contract`）。

## 解析流程

Worker 處理 DoH 請求（`/dns-query/:deviceId`）遵循以下執行順序：

1. **裝置識別與設定讀取**：從 URL 路徑取得裝置 ID。優先讀取 KV 中的執行階段設定快取（`config:v2`），未命中時回退查詢 D1 資料庫；裝置不存在時直接回應 HTTP 404。
2. **來源網路頻控 (Client Guard)**：若策略啟用了網路數限制，提取用戶端 IP（`cf-connecting-ip`）。已驗證的網路在 Worker 記憶體中快取 5 分鐘；新網路由裝置對應的 Durable Object 驗證滑動區間內的活躍網路總數。超出上限回傳 `REFUSED`（標記 `source: limited`）。若 Durable Object 異常，預設放行以確保高可用性。
3. **本機記錄與 IPv6 降級**：
   - 優先比對面板中維護的本機 A / AAAA / CNAME 記錄，命中即在邊緣合成 DNS 回應回傳。
   - 若策略組啟用了「停用 IPv6 解析」，對 AAAA 類型查詢直接回傳 `NODATA`（NOERROR 且 Answer 為空），用戶端將快速回退至 IPv4。
4. **規則過濾與服務封鎖**：當策略組啟用過濾且裝置未暫停時，使用目前規則快照以二分搜尋比對網域（僅執行策略組選取的清單與服務）：
   - **攔截**：根據設定的回應模式（`null_ip` 回傳 0.0.0.0/::、`nxdomain`、`refused`、`nodata` 或 `custom_ip`）在本機建構 DNS 封包。
   - **改寫**：命中 `$dnsrewrite` 或 hosts 規則時本機合成應答；若改寫目標為 CNAME，遞迴向上游解析目標網域。
   - **放行**：命中白名單例外規則或未比對到任何攔截規則，進入上游解析流程。
   - 檢查強制安全搜尋（Google / Bing / DuckDuckGo）與 YouTube 嚴格篩選模式。
5. **邊緣快取比對**：基於 `qclass/qtype/網域小寫/DO/CD`、目前上游集合及用戶端子網（開啟 ECS 時）產生快取鍵，查詢 Cloudflare 邊緣 Cache API。命中時遞減 TTL，還原原始用戶端 Query ID 與大小寫格式後直接回傳。
6. **上游 DoH 查詢**：快取未命中時向設定的上游 DoH 發送 RFC 8484 POST 請求：
   - **依序模式 (Fallback)**：依清單順序請求，遭遇網路錯誤、逾時或 SERVFAIL 時自動嘗試下一個節點。
   - **並行競速 (Parallel)**：並行向全部上游發起請求，採納首個非 SERVFAIL 的有效回應。
   - 全部上游失敗時回傳 `SERVFAIL`。
7. **快取寫入與 TTL 收緊**：
   - 對有效回應（NOERROR 與 NXDOMAIN）根據 RFC 2308 及設定的 Min/Max TTL 範圍進行收緊，寫入邊緣 Cache API 並回應用戶端。
   - 若策略組啟用了 ECH 或 HTTP/3 注入，且目標網域解析至 Cloudflare 代理節點，向 HTTPS 記錄注入 `alpn=h3` 與公用 ECH 參數（帶 DO 位元的 DNSSEC 查詢不注入）。
8. **非同步指標回報**：若啟用記錄，透過 `ctx.waitUntil` 向 Analytics Engine 寫入結構化查詢資料點（裝置、網域、類型、動作、延遲、上游、資料中心、用戶端類型、來源網路），不包含用戶端具體 IP，不增加回應延遲。

## 規則引擎與快照分片

Cloudflare Workers 免費層單次請求 CPU 時間限制為 10ms。EdgeDoH 避免在 Worker 執行階段解析規則文字，編譯過程完全移至瀏覽器 Web Worker 或 CLI：

### 分片儲存機制
- **精確網域與後綴規則**：轉換為 64 位元雜湊有序表，查詢時透過二分搜尋比對目標網域及逐級父網域，時間複雜度為 $O(\log N)$。
- **快照分片儲存**：規則分散儲存於 32 個分片（Shards）中，主指標鍵 `snapshot:manifest:v3` 記錄目前版本元資料。Worker 節點每 30 秒驗證一次版本指標，僅在查詢涉及未載入分片時視需要讀取並常駐記憶體。
- **複雜規則索引**：包含萬用字元與正規表示式的複雜規則單獨儲存（上限 5000 條），按必需字元標籤建立倒排索引，比對時視需要執行，避免冷啟動時批次建構 RegExp 消耗 CPU。
- **增量同步**：快照更新時前端僅向 KV 上傳新增的分片雜湊，提交新版本指標後自動清理失效的舊分片。

### 語法相容性與優先順序
- 規則優先順序遵循 AdGuard 規範：`$dnsrewrite` > `@@...$important` > `...$important` > `@@...` (白名單) > 普通攔截規則。
- 支援修飾詞：`$important`、`$badfilter`、`$dnstype`、`$client`（裝置名稱、裝置 ID、IP 或 CIDR）、`$denyallow`、`$dnsrewrite`。
- 自動剔除規則：元素隱藏規則（cosmetic filters）、瀏覽器專用修飾詞及包含 URL 路徑或連接埠的規則在編譯時自動過濾，並記錄在診斷報告中。

## 來源網路防濫用 (Client Guard)

- 每台裝置綁定一個獨立的 Durable Object（`DeviceClients`），在 SQLite 中記錄近期活躍的網路來源。
- IPv4 依單 IP 統計，IPv6 依 `/64` 子網路聚合統計以相容 SLAAC 隱私位址輪換。
- 已放行的來源網络在目前 Worker isolate 記憶體中快取 5 分鐘；常規查詢無額外儲存呼叫。
- 限制閥值與時間區間在控制台「設定 → 防濫用」中調整，設為 0 表示不限制；裝置卡片支援即時檢視網路數並提供手動重設。

## 設定與金鑰

執行階段設定由 `wrangler.jsonc` 宣告綁定與預設值，敏感金鑰透過 Worker Secrets 管理：

| 變數名稱 | 作用域 | 說明 |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Worker Secret | 保護管理面板與 `/api/*` 的 Access 團隊網域（如 `myteam.cloudflareaccess.com`） |
| `ACCESS_AUD` | Worker Secret | 面板自託管應用的 Application Audience (AUD) 標籤 |
| `CF_ACCOUNT_ID` | Worker Secret | 用於呼叫 Analytics Engine SQL API 的 Cloudflare 帳戶 ID |
| `STATS_API_TOKEN` | Worker Secret | 具備 `Account > Account Analytics > Read` 權限的 API Token，留空停用統計查詢 |
| `ACCESS_DEV_BYPASS` | 本機環境變數 | 僅限本機開發，設為 `true` 時對 localhost 請求略過 Access JWT 驗證，切勿配置至正式環境 |
| `CUSTOM_DOMAIN` | 建置環境變數 | 綁定的自訂網域，設定於 `.env.deploy` 或建置變數中，非執行時期金鑰 |

管理面板中修改的設定儲存於 D1 的 `settings` 資料表中並同步至 KV，各邊緣節點在 1 分鐘內自動熱更新。

## API 介面參考

所有 `/api/*` 介面均需攜帶有效的 Cloudflare Access JWT。異常回應統一回傳 `{ "error": "..." }`：

### 健康檢查與裝置
- `GET /api/health`：服務執行狀態檢查。
- `GET /api/devices`：取得裝置清單。
- `POST /api/devices`：建立新裝置，參數 `{ name, profileId? }`。
- `PATCH /api/devices/:id`：修改裝置名稱或綁定策略組。
- `DELETE /api/devices/:id`：刪除指定裝置。
- `GET /api/devices/:id/mobileconfig`：下載 Apple 裝置描述檔。
- `GET /api/devices/:id/clients`：取得裝置目前活躍來源網路。
- `DELETE /api/devices/:id/clients`：重設裝置來源網路記錄。
- `POST /api/devices/:id/pause`：暫停裝置過濾，參數 `{ minutes }`（0 表示恢復）。

### 規則快照與測試
- `GET /api/rules`：取得目前生效快照元資料。
- `GET /api/rules/manifest`：查詢已存在的分片清單。
- `PUT /api/rules/blobs/:hash`：上傳增量快照分片。
- `POST /api/rules/commit`：提交並啟用新版本快照。
- `DELETE /api/rules/snapshot`：停用目前快照。
- `POST /api/rules/test`：模擬測試網域規則比對結果，參數 `{ name, type, deviceId? }`。
- `GET /api/catalog`：取得官方規則庫目錄（HostlistsRegistry）。

### 過濾清單與自訂規則
- `GET /api/lists`：取得已安裝的過濾清單。
- `POST /api/lists`：安裝新過濾清單，參數 `{ url, name? }`。
- `PATCH /api/lists/:id`：修改清單啟用狀態或名稱。
- `DELETE /api/lists/:id`：卸載過濾清單。
- `POST /api/lists/:id/refresh`：重新擷取遠端清單內容。
- `GET /api/lists/:id/text`：讀取清單原文。
- `PUT /api/lists/:id/text`：更新手動清單（如分流網域）內容。
- `POST /api/lists/reports`：用戶端回報規則編譯診斷報告。
- `GET /api/custom-rules`：取得自訂規則文字。
- `PUT /api/custom-rules`：更新自訂規則文字。

### 策略組、服務與分流
- `GET /api/profiles`：取得策略組清單。
- `POST /api/profiles`：建立新策略組。
- `PATCH /api/profiles/:id`：修改策略組設定。
- `DELETE /api/profiles/:id`：刪除策略組（預設策略組不可刪除）。
- `GET /api/services/:source`：取得服務目錄（`adguard` 或 `community`）。
- `GET /api/local-records`：讀取本機 DNS 記錄。
- `PUT /api/local-records`：全量更新本機 DNS 記錄。
- `GET /api/settings`：讀取全域設定。
- `PATCH /api/settings`：更新全域設定。

### 查詢統計與日誌
- `GET /api/stats/summary`：概覽指標（查詢總量、攔截率、平均耗時等）。
- `GET /api/stats/timeseries`：時序趨勢資料。
- `GET /api/stats/top/:kind`：排行榜資料（支援 `domains`, `blocked`, `devices`, `rules`, `lists`, `upstreams`, `services`, `clients`, `networks`）。
- `GET /api/stats/logs`：分頁查詢日誌記錄，支援 `limit`, `offset`, `search`, `range`, `device`, `action`, `source` 等篩選參數。

## CLI 命令行工具

專案在 `src/cli` 提供獨立命令行工具，支援不開啟 Web 面板執行離線編譯與維護：

```bash
# 編譯規則清單為本機二進位快照
bun run cli compile adguard=https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt -o snapshot

# 上傳並啟用快照（讀取 .env 中的 Access Service Token）
bun run cli upload snapshot --url https://dns.example.com
```

若未部署面板，可透過 wrangler 直接操作 D1 資料庫：

```bash
bunx wrangler d1 execute DB --remote --command "INSERT INTO devices (id, name, created_at) VALUES ('<10位ID>', '<裝置名>', <時間戳記>)"
```

## 目錄結構

```text
src/
├── lib/           # 跨平台演算法與通訊協定編解碼
│   ├── dns/       # 標準 DNS 封包編解碼，零執行時期依賴（別名 #dns）
│   ├── filter/    # 規則解析、快照編譯與比對引擎（別名 #filter）
│   └── contract/  # 前後端共用的限制常數與列舉（別名 #contract）
├── worker/        # Cloudflare Worker 後端原始碼
│   ├── features/  # 業務模組（devices, doh, lists, profiles, records, rules, services, settings, stats）
│   ├── shared/    # 驗證中介軟體、設定同步、錯誤模型與通用校驗
│   └── test/      # 上游 Mock 與測試輔助工具
├── web/           # 管理面板前端（Vite + React 19 + Tailwind CSS v4 + shadcn/ui）
│   ├── app/       # 路由與全域版面
│   ├── features/  # 業務視圖元件
│   ├── shared/    # UI 基礎元件、通用 hooks、工具函式與 i18n 資源
│   └── test/      # 單元測試環境設定
├── cli/           # 命令行工具與一鍵互動部署指令碼
docs/              # 專案文件與部署指南
migrations/        # D1 關聯式資料庫結構遷移指令碼
tsconfig/          # 分層 TypeScript 編譯設定
```

## 驗證與測試規範

提交程式碼前應在本機執行完整驗證鏈：

```bash
bun run typecheck
bun run test
bun run build
```

- **型別檢查**：`bun run typecheck` 先產生並驗證 `worker-configuration.d.ts`，再執行分層 `tsc -b`。
- **自動化測試**：Worker 模組在真實 workerd 環境中執行（基於 `@cloudflare/vitest-plugin`），前端與演算法測試在 Node / happy-dom 環境中執行。
- **正式建置**：`bun run build` 驗證前端靜態成品與 Worker 打包輸出。
