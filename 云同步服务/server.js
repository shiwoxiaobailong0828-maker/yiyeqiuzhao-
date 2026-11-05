/**
 * 秋招指挥舱 · 云同步服务端（零依赖，本机直接跑）
 *
 * 用法：
 *   1) 装好 Node.js（>=16）
 *   2) 双击「启动云同步服务.bat」，或命令行执行 node server.js
 *   3) 看板「更多操作 → 云端同步」填：
 *        云端地址：http://127.0.0.1:8787
 *        访问令牌：qiuzhao-2027-ao-xuan （可用环境变量 TOKEN 改）
 *   4) 手机与电脑在同一 Wi-Fi 时，手机填 http://电脑局域网IP:8787
 *
 * 协议：
 *   GET  ?token=xxx                  → { ok, data, rev, updatedAt }
 *   GET  ?token=xxx&action=ping      → { ok, server, time }
 *   POST ?token=xxx                  → body 为全量数据 JSON
 *   POST ?token=xxx&action=save-chunk → { key, index, total, data(base64) }
 *   POST ?token=xxx&action=save-merge → { key, total }
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.TOKEN || "change-me-2027";
const DATA_FILE = path.join(__dirname, "cloud-data.json");
const MAX_BODY = 12 * 1024 * 1024; // 12MB

let chunks = new Map(); // key -> { total, parts: [] }

function readStore() {
  try {
    const j = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { payload: j.payload || null, rev: j.rev || 0, updatedAt: j.updatedAt || 0 };
  } catch (e) {
    return { payload: null, rev: 0, updatedAt: 0 };
  }
}

function writeStore(payload) {
  const now = Date.now();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ payload, rev: now, updatedAt: now }));
  fs.renameSync(tmp, DATA_FILE); // 原子写，避免写一半断掉
  return now;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const send = (code, obj) => {
    res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders()));
    res.end(JSON.stringify(obj));
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (u.searchParams.get("token") !== TOKEN) {
    return send(401, { ok: false, msg: "令牌不正确" });
  }

  const action = u.searchParams.get("action") || "";

  if (req.method === "GET") {
    if (action === "ping") return send(200, { ok: true, server: "node-local", time: Date.now() });
    const st = readStore();
    return send(200, { ok: true, data: st.payload, rev: st.rev, updatedAt: st.updatedAt });
  }

  if (req.method === "POST") {
    let body = "";
    let tooBig = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on("end", () => {
      if (tooBig) return send(413, { ok: false, msg: "数据过大" });

      let j;
      try { j = JSON.parse(body || "{}"); }
      catch (e) { return send(400, { ok: false, msg: "JSON 解析失败" }); }

      // 分片：接收
      if (action === "save-chunk") {
        if (!j.key) return send(400, { ok: false, msg: "缺少 key" });
        let rec = chunks.get(j.key);
        if (!rec) { rec = { total: j.total || 0, parts: [] }; chunks.set(j.key, rec); }
        rec.parts[j.index] = j.data;
        rec.total = j.total || rec.total;
        return send(200, { ok: true, received: j.index });
      }

      // 分片：合并
      if (action === "save-merge") {
        const rec = chunks.get(j.key);
        if (!rec) return send(400, { ok: false, msg: "没有找到待合并的分片" });
        try {
          const b64 = rec.parts.filter((x) => typeof x === "string").join("");
          const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
          if (!payload || !Array.isArray(payload.apps)) return send(400, { ok: false, msg: "数据格式不对（缺少 apps）" });
          chunks.delete(j.key);
          const rev = writeStore(payload);
          console.log("[sync] 分片合并写入成功 rev=" + rev + "，投递 " + payload.apps.length + " 条");
          return send(200, { ok: true, rev });
        } catch (e) {
          return send(400, { ok: false, msg: "合并失败：" + e.message });
        }
      }

      // 整包保存
      if (!j || !Array.isArray(j.apps)) return send(400, { ok: false, msg: "数据格式不对（缺少 apps）" });
      const rev = writeStore(j);
      console.log("[sync] 写入成功 rev=" + rev + "，投递 " + j.apps.length + " 条");
      return send(200, { ok: true, rev });
    });
    return;
  }

  send(405, { ok: false, msg: "不支持的请求方法" });
});

// 定期清理超过 10 分钟没合并的分片，避免占内存
setInterval(() => {
  if (chunks.size > 20) chunks = new Map();
}, 10 * 60 * 1000);

server.listen(PORT, "0.0.0.0", () => {
  const ips = [];
  Object.values(os.networkInterfaces()).forEach((list) => {
    (list || []).forEach((n) => {
      if (n.family === "IPv4" && !n.internal) ips.push(n.address);
    });
  });
  console.log("");
  console.log("  秋招指挥舱 · 云同步服务已启动");
  console.log("  ----------------------------------------");
  console.log("  本机地址：http://127.0.0.1:" + PORT);
  ips.forEach((ip) => console.log("  局域网：  http://" + ip + ":" + PORT + "  (手机同一 Wi-Fi 可用)"));
  console.log("  访问令牌：" + TOKEN);
  console.log("  数据文件：" + DATA_FILE);
  console.log("  ----------------------------------------");
  console.log("  把这个地址和令牌填到「更多操作 → 云端同步」即可");
  console.log("");
});
