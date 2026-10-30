# 部署指南

<div align="center">

[简体中文](deploy.md) · **繁體中文** · [English](deploy.en.md)

</div>

EdgeDoH 提供兩種部署方式：本機互動式一鍵部署指令碼（推薦），或透過 GitHub 上的 Deploy to Cloudflare 按鈕自動化部署。兩種方式依賴的前置資源相同，部署前請先完成前置準備。

## 前置準備

### 1. 帳號與網域規劃

1. 準備一個 Cloudflare 帳號（Workers 免費層即可滿足個人與家庭日常需求）。
2. 準備一個已託管在目前 Cloudflare 帳號下的根網域（如 `example.com`），解析服務將綁定在子網域上（如 `dns.example.com`）。
3. 無需提前建立子網域 DNS 記錄，部署流程會自動分配並綁定。若此前已有同名 DNS 記錄，請提前刪除以避免衝突。
4. 關於 workers.dev 網域限制：Cloudflare 預設的 `*.workers.dev` 網域下 Cache API 不生效，且在中國大陸地區無法直接存取，強烈建議綁定獨立自訂網域。
5. 取得帳戶 ID：登入 Cloudflare 控制台，在首頁右下角複製「帳戶 ID」，或從瀏覽器網址列提取（`dash.cloudflare.com/<帳戶ID>`）。

### 2. 初始化 Zero Trust 團隊

管理面板與管理 API 全部受 Cloudflare Access (Zero Trust) 保護。若未設定驗證憑證，Worker 將回傳 HTTP 503 拒絕所有管理請求。

1. 前往 [Zero Trust 控制台](https://one.dash.cloudflare.com/)。首次使用按指引建立團隊名稱，計劃選擇 Free。
2. 進入「設定 → 自訂」，記錄團隊網域（格式通常為 `your-team.cloudflareaccess.com`），對應設定項目 `ACCESS_TEAM_DOMAIN`。
3. 進入「設定 → 身分驗證」，確保已啟用至少一種登入驗證方式（預設開啟的電子郵件單次 PIN 驗證碼即可直接使用）。

### 3. 設定 Access 應用程式規則

進入「Access → 應用程式 → 新增應用程式 → 自託管」，以 `dns.example.com` 為例依次建立兩個應用：

| 應用程式名稱 | 路徑 (Path) | 策略設定 | 說明 |
| --- | --- | --- | --- |
| `EdgeDoH 控制台` | 留空（保護全站） | 操作：`Allow`<br>規則包含：`Emails` 填入管理員信箱 | 僅允許指定的信箱登入面板並呼叫 `/api/*` |
| `EdgeDoH DoH` | `dns-query` | 操作：`Bypass`<br>規則包含：`Everyone` | 允許所有用戶端直連 DoH 介面，略過登入驗證 |

Cloudflare Access 遵循最長前綴優先比對原則。建立路徑為 `dns-query` 的 Bypass 規則後，發往 `/dns-query` 及 `/dns-query/*` 的 DoH 查詢請求都會直接放行，避免因重新導向至登入頁導致用戶端解析失敗。

建立完第一個面板應用後，進入該應用的「基本資訊 (Overview)」，複製「應用程式受眾 (AUD) 標籤」，對應設定項目 `ACCESS_AUD`。

### 4. 建立 Analytics Engine 統計憑證（選填）

若需要啟用儀表板中的查詢分析、圖表統計與日誌功能，需要建立一個用於呼叫 Analytics Engine SQL API 的權杖：

1. 進入 Cloudflare 控制台「我的個人資料 → API 權杖 → 建立權杖 → 建立自訂權杖」。
2. 權限新增：`帳戶 → 帳戶分析 → 讀取` (Account > Account Analytics > Read)。
3. 帳戶資源選擇「包含 → 指定帳戶（或所有帳戶）」。
4. 建立後複製產生的 Token 字串，對應設定項目 `STATS_API_TOKEN`。

若無需統計圖表，此項可留空。此時僅面板內的統計頁面不可用，核心 DNS 解析與廣告攔截功能均不受影響。

### 5. 憑證清單彙總

部署前請確認已收集齊以下 4 項憑證：

| 變數名稱 | 取得途徑 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Zero Trust 團隊網域（第 2 步） |
| `ACCESS_AUD` | 面板 Access 應用的 AUD 標籤（第 3 步） |
| `CF_ACCOUNT_ID` | Cloudflare 帳戶 ID（第 1 步，互動指令碼可自動取得） |
| `STATS_API_TOKEN` | 具備帳戶分析讀取權限的 API 權杖（第 4 步，選填） |

## 方式一：本機互動式一鍵部署（推薦）

依賴本機環境安裝 [Bun](https://bun.sh) 與 `git`。

```bash
git clone https://github.com/ChouChiu/EdgeDoH.git
cd EdgeDoH
bun install
bun run setup
```

互動指令碼將自動執行以下流程：

1. 檢查 wrangler 登入狀態，未登入時自動喚起瀏覽器授權；帳號不止一個時提供序號選擇。
2. 提示輸入自訂網域（如 `dns.example.com`），設定儲存至本機 `.env.deploy`。
3. 檢查並自動建立 D1 資料庫 (`edgedoh`) 與 KV 命名空間 (`edgedoh-rules`)，將產生的資源 ID 回寫至 `wrangler.jsonc`（該檔案不納入版本控制，首次執行由 `wrangler.example.jsonc` 建立）。
4. 提示輸入缺失的必需金鑰，寫入本機 `.env.production`。
5. 編譯前端面板與 Worker，執行 D1 遠端資料庫遷移，並將憑證批次加密上傳至 Worker 完成部署。

- 指令碼支援多次執行，已建立的資源與已儲存的憑證均會自動重用。
- 若需指定 D1 資料庫實體位置，可在執行指令碼前手動執行 `bunx wrangler d1 create edgedoh --location apac`，指令碼將自動關聯已有資料庫。
- 後續更新程式碼並部署僅需執行：
  ```bash
  git pull && bun install && bun run deploy
  ```

## 方式二：Deploy to Cloudflare 按鈕

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChouChiu/EdgeDoH)

> `wrangler.jsonc` 含帳號資源 ID，不納入版本控制。使用按鈕前請先 Fork 本儲存庫，在 Fork 中提交一份由 `wrangler.example.jsonc` 複製的 `wrangler.jsonc`（D1 與 KV 的 ID 留空，由 Cloudflare 建立後回填），並把按鈕連結中的 `url` 換成自己的儲存庫位址。

1. 點擊按鈕進入 Cloudflare Workers 快速部署流程，授權存取 GitHub，系統將自動把儲存庫 Fork 至個人 GitHub 帳號下。
2. 頁面將自動識別並列出需要建立的 D1、KV 與 Durable Object 資源綁定，保持預設設定即可。
3. 根據前置準備收集的資訊填寫 4 個環境變數金鑰（`CF_ACCOUNT_ID` 需手動填寫）。
4. 建置命令與部署命令均已預設（已包含 D1 遠端遷移邏輯），保持預設並點擊部署。
5. 部署完成後綁定自訂網域：
   - 進入 Worker 的「設定 → 建置 → 變數和機密」；
   - 新增建置變數：名稱為 `CUSTOM_DOMAIN`，值為你的解析網域（例如 `dns.example.com`）；
   - 進入「部署」索引標籤，點擊重新建置（Retry deployment），完成網域綁定。
6. 後續只需向個人儲存庫的 `main` 分支推送提交，Cloudflare 將自動觸發持續整合與重新部署。

請透過建置變數 `CUSTOM_DOMAIN` 綁定網域，避免在控制台「網域和路由」中手動新增。手動綁定的自訂網域不在 Worker 建置設定內，後續重新建置時可能會被覆蓋。

## 部署後設定與驗證

1. **登入控制台**：在瀏覽器中開啟 `https://dns.example.com`，透過 Cloudflare Access 完成電子郵件驗證登入。
2. **新增裝置**：進入「裝置」頁面點擊「新增裝置」，取得專屬的 DoH 接入點位址（格式為 `https://dns.example.com/dns-query/<裝置ID>`）。Apple 平台使用者可直接點擊下載 `.mobileconfig` 描述檔。
3. **訂閱規則清單**：進入「過濾清單」頁面，點擊「規則庫目錄」，挑選並安裝常用規則清單（如 AdGuard DNS filter）。瀏覽器將在本機 Web Worker 中自動完成編譯並將規則快照分片上傳至邊緣節點。
4. **解析鏈路驗證**：使用命令行發送標準 RFC 8484 二進位 DNS 請求，確認收到二進位 DNS 回應封包：

```bash
curl -s -H 'accept: application/dns-message' \
  'https://dns.example.com/dns-query/<裝置ID>?dns=q80BAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE' | xxd | head
```

## 常見問題排查

### 1. 部署報錯 required secrets have not been set
首次部署缺少必需的環境變數。請確認 `.env.production` 中已填入 `ACCESS_TEAM_DOMAIN` 與 `ACCESS_AUD`，然後重新執行 `bun run setup` 或 `bun run secrets:push`。

### 2. 部署報錯 10053 或 secret with the same name already exists
`ACCESS_DEV_BYPASS` 在 `wrangler.jsonc` 的 `vars` 欄位中已宣告為一般執行時期變數。Cloudflare 規定一般變數與 Secret 不得同名，切勿將 `ACCESS_DEV_BYPASS` 寫入 `.env.production` 或 Cloudflare 正式金鑰中。

### 3. 面板或 API 請求回傳 HTTP 503
說明 Worker 未讀取到 `ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD` 憑證。請在 `.env.production` 中補齊並執行 `bun run secrets:push`。若僅統計分析頁面回傳 503，說明 `STATS_API_TOKEN` 未設定或權限不正確。

### 4. API 請求回傳 HTTP 401
請求未攜帶有效的 Cloudflare Access JWT 權杖。通常是因為存取的主機名稱未包含在 Access 應用程式保護範圍內，導致請求未經過 Access 閘道插入認證 Header。

### 5. API 請求回傳 HTTP 403
Access JWT 權杖驗證失敗。請核對 Worker 的 `ACCESS_AUD` 金鑰是否與保護該網域的 Access 應用程式中的 AUD 完全一致，並確認 `ACCESS_TEAM_DOMAIN` 團隊網域無拼寫錯誤。

### 6. 用戶端無法解析 DNS 或收到 HTML 回應
說明缺少路徑為 `dns-query` 的 Access Bypass 應用程式，導致用戶端發起的 DNS 查詢被攔截並重新導向至 Access 網頁登入頁面。請檢查前置準備第 3 步中的兩條 Access 策略設定。

### 7. 自訂網域無法綁定
確認該網域已新增至目前 Cloudflare 帳號且處於活躍狀態；同時檢查該子網域是否已存在同名的 A/AAAA/CNAME 解析記錄，如有請先刪除。

### 8. 統計頁面顯示無資料或查詢報錯
- 新部署的實例需要等待產生實際 DNS 解析請求後，Analytics Engine 才會收集到指標資料。
- 確認 `STATS_API_TOKEN` 具備「帳戶分析 > 讀取」權限，且設定的 `CF_ACCOUNT_ID` 與該 Token 所屬帳號嚴格對應。
