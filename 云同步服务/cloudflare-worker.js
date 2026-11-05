/**
 * 秋招指挥舱 · 云同步（Cloudflare Worker 版，免费、公网 HTTPS）
 *
 * 为什么用它：本机 Node 服务只有同一 Wi-Fi 能用；Worker 部署后手机在外面也能同步。
 *
 * 部署（网页操作，5 分钟）：
 *   1) 打开 https://dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2) 把本文件内容整体粘进去，Deploy
 *   3) 在该 Worker 的 Settings → Variables → 添加 KV Namespace Binding：
 *        变量名填 BOARD，绑定一个新建的 KV 命名空间
 *   4) Settings → Variables → 添加环境变量 TOKEN = 你的令牌
 *   5) Worker 地址形如 https://qiuzhao-sync.你的账号.workers.dev，
 *      填到看板「更多操作 → 云端同步」，令牌填一样的值
 *
 * 协议与 server.js 完全一致（GET / POST / save-chunk / save-merge / ping）
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS)
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.searchParams.get("token") !== env.TOKEN) return json(401, { ok: false, msg: "令牌不正确" });

    const action = url.searchParams.get("action") || "";

    if (request.method === "GET") {
      if (action === "ping") return json(200, { ok: true, server: "cf-worker", time: Date.now() });
      const raw = await env.BOARD.get("board");
      if (!raw) return json(200, { ok: true, data: null, enc: 0, rev: 0 });
      const st = JSON.parse(raw);
      return json(200, { ok: true, data: st.payload, enc: st.enc ? 1 : 0, device: st.device || null, rev: st.rev, updatedAt: st.updatedAt });
    }

    if (request.method === "POST") {
      let j;
      try { j = await request.json(); }
      catch (e) { return json(400, { ok: false, msg: "JSON 解析失败" }); }

      if (action === "save-chunk") {
        if (!j.key) return json(400, { ok: false, msg: "缺少 key" });
        const k = "chunk:" + j.key + ":" + j.index;
        await env.BOARD.put(k, j.data, { expirationTtl: 600 });
        return json(200, { ok: true, received: j.index });
      }

      if (action === "save-merge") {
        let b64 = "";
        for (let i = 0; i < (j.total || 0); i++) {
          const part = await env.BOARD.get("chunk:" + j.key + ":" + i);
          if (!part) return json(400, { ok: false, msg: "分片 " + i + " 缺失" });
          b64 += part;
        }
        try {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const parsed = JSON.parse(new TextDecoder().decode(bin));
          const envl = parsed && Object.prototype.hasOwnProperty.call(parsed, "payload") ? parsed : { payload: parsed, enc: 0, device: null };
          if (!envl.payload) return json(400, { ok: false, msg: "数据为空" });
          if (!envl.enc && !Array.isArray(envl.payload.apps)) return json(400, { ok: false, msg: "数据格式不对" });
          const now = Date.now();
          await env.BOARD.put("board", JSON.stringify({ payload: envl.payload, enc: envl.enc ? 1 : 0, device: envl.device || null, rev: now, updatedAt: now }));
          return json(200, { ok: true, rev: now });
        } catch (e) {
          return json(400, { ok: false, msg: "合并失败：" + e.message });
        }
      }

      const envl = j && Object.prototype.hasOwnProperty.call(j, "payload") ? j : { payload: j, enc: 0, device: null };
      if (!envl.payload) return json(400, { ok: false, msg: "数据为空" });
      if (!envl.enc && !Array.isArray(envl.payload.apps)) return json(400, { ok: false, msg: "数据格式不对（缺少 apps）" });
      const now = Date.now();
      await env.BOARD.put("board", JSON.stringify({ payload: envl.payload, enc: envl.enc ? 1 : 0, device: envl.device || null, rev: now, updatedAt: now }));
      return json(200, { ok: true, rev: now });
    }

    return json(405, { ok: false, msg: "不支持的请求方法" });
  }
};
