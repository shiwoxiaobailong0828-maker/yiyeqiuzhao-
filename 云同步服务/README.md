# 云同步服务（能直接跑起来的那种）

「一页秋招 / 秋招指挥舱」默认是**纯本地**的：数据存在浏览器里，不上传任何服务器。
这个目录提供两种**可选**的同步后端，用来在手机和电脑之间互传数据。

---

## 方案 A：本机服务（最快，5 分钟）

适合：手机和电脑在**同一个 Wi-Fi**，或者只想先验证功能。

### 1. 装 Node.js
版本 ≥ 16 即可（本服务零依赖，不需要 npm install）。

### 2. 启动
双击 **`启动云同步服务.bat`**，或在命令行执行：

```bash
node server.js
```

启动后终端会打印：

```
本机地址：http://127.0.0.1:8787
局域网：  http://192.168.x.x:8787  (手机同一 Wi-Fi 可用)
访问令牌：change-me-2027
数据文件：.../cloud-data.json
```

### 3. 在看板里填写
顶栏「**更多操作 → 云端同步**」：

| 字段 | 填什么 |
|---|---|
| 云端地址 | `http://127.0.0.1:8787`（本机）或 `http://192.168.x.x:8787`（手机） |
| 访问令牌 | `change-me-2027`（或你启动时用环境变量 `TOKEN` 改的值） |

点「保存并测试」→ 显示「已同步」即成功。

### 4. 换令牌 / 换端口
```bash
# Windows PowerShell
$env:TOKEN="你自己的口令"; $env:PORT="9000"; node server.js

# Git Bash / macOS / Linux
TOKEN=你自己的口令 PORT=9000 node server.js
```

> 数据存在同目录 `cloud-data.json`，删掉它就等于清空云端。

---

## 方案 B：Cloudflare Worker（公网，手机随时能同步）

适合：手机不在家、用 4G 也想同步。

1. 打开 https://dash.cloudflare.com → Workers & Pages → Create → Worker
2. 把 `cloudflare-worker.js` 内容整体粘进去 → Deploy
3. 该 Worker → Settings → Variables：
   - 添加 **KV Namespace Binding**，变量名 `BOARD`，绑定一个新建的命名空间
   - 添加环境变量 `TOKEN` = 你的令牌
4. 把 Worker 地址（`https://xxx.workers.dev`）填进看板，令牌填同一个

免费额度足够个人使用。

---

## 接口约定（想自己写后端时照这个来）

| 请求 | 说明 |
|---|---|
| `GET 地址?token=xxx` | 返回 `{ok:true, data:<全量数据或 null>, rev:<版本号>, updatedAt}` |
| `GET 地址?token=xxx&action=ping` | 连通性探测，返回 `{ok:true, server, time}` |
| `POST 地址?token=xxx` | body 为全量数据 JSON（必须含 `apps` 数组） |
| `POST 地址?token=xxx&action=save-chunk` | `{key, index, total, data(base64)}`，大包分片 |
| `POST 地址?token=xxx&action=save-merge` | `{key, total}`，合并分片并落库 |

- token 不匹配请返回 **401**
- 必须允许跨域：`Access-Control-Allow-Origin: *`、允许 `Content-Type` 头、支持 `OPTIONS`
- `rev` 建议用**服务器时间戳**（客户端会采纳它，保证多端版本可比）
- 数据超过 90KB 时前端自动走分片，最多 12MB

---

## 前端同步策略（已实现）

1. **自动上传**：本地改动后 1.2 秒防抖上传，失败自动重试（最多 12 次退避）
2. **不发覆盖**：检测到云端版本更新时，只在状态栏提示「云端有更新」，**不会**偷偷覆盖本机
3. **手动拉取**：点「拉取云端数据」才会用云端覆盖本机
4. **版本对齐**：上传成功后采用服务器返回的 `rev`，两端版本号同一时钟，比较准确
5. **分片**：数据 > 90KB 自动分片上传，合并后落库
6. **状态可见**：配置面板显示「上次同步时间 / 本机最后修改 / 是否有云端更新」

---

## 常见问题

**Q：连不上，提示 CORS 或 Failed to fetch？**
- 地址必须是 `http://` 或 `https://` 开头，不能漏协议
- 本机服务要处于运行状态（终端窗口别关）
- 手机用局域网地址时，确认防火墙允许 8787 端口

**Q：手机填 127.0.0.1 不行？**
- `127.0.0.1` 指手机自己。手机要用电脑的**局域网 IP**（启动日志里会打印）

**Q：会不会把我的数据传到第三方？**
- 不会。方案 A 只在你自己的电脑上；方案 B 存在你自己的 Cloudflare 账号里

**Q：不配这个能不能用？**
- 完全可以。本地功能不受任何影响，只是没有多设备同步
