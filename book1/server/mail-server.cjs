/* ============================================================
   PET 精读 · 发信服务

   干两件事：
     1. 托管那个 HTML（让页面和接口同源，绕开 CORS 和混合内容限制）
     2. 提供 POST /api/send，用 SMTP 把历史记录发到你的邮箱

   启动：
     cd server && npm install && node mail-server.cjs
   然后浏览器打开：
     http://<服务器IP>:8787/

   配置：把 config.example.json 复制成 config.json 再改。
   config.json 里是 SMTP 凭据，不要提交到 git。
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const ROOT = path.join(__dirname, "..");
const CONF_FILE = path.join(__dirname, "config.json");
const MAX_BODY = 20 * 1024 * 1024;      // 20MB，附件够用了

/* ---------- 配置 ---------- */
function loadConfig() {
  if (!fs.existsSync(CONF_FILE)) {
    console.error("\n✗ 找不到 " + CONF_FILE);
    console.error("  先把 config.example.json 复制成 config.json 再改。\n");
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONF_FILE, "utf8"));
  } catch (e) {
    console.error("\n✗ config.json 不是合法的 JSON：" + e.message + "\n");
    process.exit(1);
  }
  const miss = ["host", "user", "pass", "to"].filter(k => !cfg[k]);
  if (miss.length) {
    console.error("\n✗ config.json 缺少必填项：" + miss.join(", ") + "\n");
    process.exit(1);
  }
  cfg.port = cfg.port || 8787;
  cfg.smtpPort = cfg.smtpPort || 465;
  // 465 是 implicit TLS（secure:true），587 是 STARTTLS（secure:false）
  if (cfg.secure === undefined) cfg.secure = cfg.smtpPort === 465;
  cfg.from = cfg.from || cfg.user;
  cfg.token = cfg.token || "";          // 留空就不校验口令
  return cfg;
}

const cfg = loadConfig();

const mailer = nodemailer.createTransport({
  host: cfg.host,
  port: cfg.smtpPort,
  secure: cfg.secure,
  auth: { user: cfg.user, pass: cfg.pass },
  connectionTimeout: 15000,
  greetingTimeout: 10000
});

/* ---------- 工具 ---------- */
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
  });
  res.end(body);
}

// SMTP 报错五花八门，翻译成人能看懂的话
function friendly(err) {
  const m = String((err && err.message) || err);
  if (/Invalid login|authentication|535|EAUTH/i.test(m))
    return "邮箱认证失败。多半是授权码不对 —— 注意它不是你登录邮箱的密码，要去邮箱设置里单独开 SMTP 并生成授权码。";
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ESOCKET/i.test(m))
    return "连不上 SMTP 服务器（" + cfg.host + ":" + cfg.smtpPort + "）。检查主机名、端口，以及服务器能否出网。";
  if (/self signed|CERT/i.test(m))
    return "SMTP 证书校验失败。自建邮件服务器可以试试把 smtpPort 改成 25 或 587。";
  if (/550|553|Sender|recipient/i.test(m))
    return "发件人或收件人被拒。确认 from 和 to 都是这个邮箱服务商认可的地址。";
  return m;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("内容太大")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ---------- 托管页面 ----------
   服务端在这里把口令注入进去，所以磁盘上的 HTML 里没有口令。
   本地双击打开时占位符原样保留，而那时发送按钮本来就是禁用的。 */
function serveHtml(res) {
  const dir = ROOT;
  let file = fs.readdirSync(dir).filter(f => /^PET精读-.*\.html$/.test(f) && !/1\.0\.html$/.test(f))[0];
  if (!file) return send(res, 404, { error: "没找到构建产物，先跑 node build.mjs" });
  let html = fs.readFileSync(path.join(dir, file), "utf8");
  html = html.replace(/__MAIL_TOKEN__/g, cfg.token);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (req.method === "OPTIONS") {
    return send(res, 204, {});
  }

  if (req.method === "GET" && url === "/api/health") {
    // 页面靠这个判断"我是不是被服务器托管的"，据此决定发送按钮能不能点
    return send(res, 200, {
      ok: true,
      needToken: !!cfg.token,
      to: cfg.to.replace(/^(.).*@/, "$1***@")     // 只回显一部分，别把完整地址暴露出去
    });
  }

  if (req.method === "POST" && url === "/api/send") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, 400, { error: "请求体不是合法 JSON：" + e.message });
    }

    if (cfg.token && payload.token !== cfg.token) {
      return send(res, 403, { error: "口令不对。页面是从这台服务器打开的吗？" });
    }
    if (!payload.subject || !payload.filename || !payload.content) {
      return send(res, 400, { error: "缺少 subject / filename / content" });
    }

    try {
      const info = await mailer.sendMail({
        from: cfg.from,
        to: cfg.to,
        subject: String(payload.subject).slice(0, 200),
        text: String(payload.body || "见附件。"),
        attachments: [{
          filename: String(payload.filename),
          content: Buffer.from(payload.content, "base64"),
          contentType: "application/msword"
        }]
      });
      console.log("[" + new Date().toLocaleString() + "] 已发送 → " + cfg.to +
                  "  " + payload.filename + "  (" + info.messageId + ")");
      return send(res, 200, { ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("[" + new Date().toLocaleString() + "] 发送失败：" + err.message);
      return send(res, 500, { error: friendly(err) });
    }
  }

  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    return serveHtml(res);
  }

  send(res, 404, { error: "没有这个路径" });
});

server.listen(cfg.port, "0.0.0.0", async () => {
  console.log("PET 精读 · 发信服务已启动");
  console.log("  监听    http://0.0.0.0:" + cfg.port + "/");
  console.log("  SMTP    " + cfg.host + ":" + cfg.smtpPort + " (" + (cfg.secure ? "TLS" : "STARTTLS") + ")");
  console.log("  发件人  " + cfg.from);
  console.log("  收件人  " + cfg.to);
  console.log("  口令    " + (cfg.token ? "已启用" : "未启用（config.json 里加 token 字段可开启）"));
  // 启动时先验一次 SMTP，别等用户点了发送才发现配置错
  try {
    await mailer.verify();
    console.log("  SMTP 连接测试：通过 ✓");
  } catch (e) {
    console.log("  SMTP 连接测试：失败 ✗  " + friendly(e));
  }
  console.log("");
});
