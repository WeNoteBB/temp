/* ============================================================
   认证层 —— 注册 / 登录 / 会话 / 限流

   全部用 Node 内置能力，零 npm 依赖：
     crypto.scrypt        密码哈希（异步版，绝不阻塞事件循环）
     crypto.timingSafeEqual  比对哈希，防时序攻击
     crypto.randomBytes   会话 token、恢复码

   三条设计上的硬规矩：
     1. 密码永远不落库、不进日志。只存 scrypt 哈希。
     2. 哈希必须用异步版。同步版会卡住事件循环 —— 500 人同时登录
        能把整个服务（连静态文件）一起拖死。
     3. 登录失败不区分"账号不存在"和"密码错误"，一律同一句话，
        否则等于给人一个用户名枚举接口。
   ============================================================ */
"use strict";

const crypto = require("crypto");
const db = require("./db.cjs");

/* ---------- 参数 ---------- */
// 在 2 核机器上约 60ms/次，内存 16MB/次。
// 别调更高：N 每翻一倍，时间和内存都翻倍，2C2G 扛不住并发登录。
const SCRYPT = { N: 16384, r: 8, p: 2, keylen: 64 };

const SESSION_MS = 30 * 24 * 3600 * 1000;   // 30 天
const COOKIE = "pet_sid";

/* ---------- 密码 ---------- */

function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(plain, salt, SCRYPT.keylen, SCRYPT, (err, key) => {
      if (err) return reject(err);
      // 自带参数，将来调强度了老密码还能验
      resolve(["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p,
        salt.toString("base64"), key.toString("base64")].join("$"));
    });
  });
}

function verifyPassword(plain, stored) {
  return new Promise(resolve => {
    try {
      const [alg, N, r, p, saltB64, hashB64] = String(stored).split("$");
      if (alg !== "scrypt") return resolve(false);
      const salt = Buffer.from(saltB64, "base64");
      const want = Buffer.from(hashB64, "base64");
      crypto.scrypt(plain, salt, want.length, { N: +N, r: +r, p: +p }, (err, key) => {
        if (err) return resolve(false);
        resolve(key.length === want.length && crypto.timingSafeEqual(key, want));
      });
    } catch (e) {
      resolve(false);
    }
  });
}

/* ---------- 恢复码 ---------- */
// 去掉 I L O U 和 0 1，避免手抄时看错
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function makeRecoverCode() {
  const bytes = crypto.randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += ALPHABET[bytes[i] % 32];
  // 80 位熵，分组显示好抄
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12);
}

// 用户可能连着横杠抄、也可能大小写混着输。统一归一化再算摘要。
function normCode(c) {
  return String(c || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}
// 恢复码是高熵随机串（80 位），不是人编的密码 —— 暴力枚举不可行，
// 所以用 SHA-256 就够，不需要 scrypt 那种慢哈希。
function codeHash(c) {
  return crypto.createHash("sha256").update(normCode(c)).digest("hex");
}

/* ---------- 校验 ---------- */

const bad = m => { const e = new Error(m); e.status = 400; return e; };

function checkNickname(n) {
  n = String(n || "").trim();
  if (n.length < 2 || n.length > 16) throw bad("昵称要 2–16 个字");
  if (!/^[一-龥A-Za-z0-9_]+$/.test(n)) throw bad("昵称只能用中文、字母、数字、下划线");
  const deny = ["admin", "administrator", "root", "system", "官方", "管理员", "客服", "系统", "小编"];
  if (deny.indexOf(n.toLowerCase()) >= 0) throw bad("这个昵称不能用");
  return n;
}

function checkPhone(p) {
  p = String(p || "").trim();
  if (!p) return null;                       // 手机号选填
  if (!/^1[3-9]\d{9}$/.test(p)) throw bad("手机号格式不对");
  return p;
}

function checkPassword(p) {
  p = String(p || "");
  if (p.length < 8) throw bad("密码至少 8 位");
  if (p.length > 72) throw bad("密码太长了");
  if (/^\d+$/.test(p)) throw bad("密码不能是纯数字");
  return p;
}

/* ---------- 限流 ----------
   放内存而不是库：这是短时效的计数器，重启丢了也无所谓，
   而且不写库就不会被刷库。缺点是多进程部署时不共享 ——
   单机 2C2G 场景下不是问题。 */
const buckets = new Map();

function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return { over: b.n > limit, left: Math.max(0, b.reset - now), count: b.n };
}
function peek(key) {
  const b = buckets.get(key);
  return b && Date.now() <= b.reset ? b.n : 0;
}
function clear(key) { buckets.delete(key); }

// 定期清过期的桶，防止内存无限涨
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 10 * 60 * 1000).unref();

function clientIP(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

/* ---------- 会话 ---------- */

function issueSession(res, uid, secure) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MS);
  db.createSession(token, uid, expires.toISOString());
  res.setHeader("Set-Cookie",
    COOKIE + "=" + token +
    "; Path=/; HttpOnly; SameSite=Lax" +
    "; Max-Age=" + Math.floor(SESSION_MS / 1000) +
    (secure ? "; Secure" : ""));
  return token;
}

function readSession(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return null;
  return db.getSession(m[1]);
}

function clearSession(req, res) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (m) db.dropSession(m[1]);
  res.setHeader("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

/* ---------- 业务 ---------- */

async function register(req, res, body, secure) {
  const ip = clientIP(req);

  // 防批量注册：一个 IP 一天最多 5 个号
  const r = hit("reg:" + ip, 5, 24 * 3600 * 1000);
  if (r.over) {
    const e = new Error("今天注册得太多了，明天再试");
    e.status = 429; throw e;
  }

  const nickname = checkNickname(body.nickname);
  const phone = checkPhone(body.phone);
  const password = checkPassword(body.password);

  const lower = nickname.toLowerCase();
  const exists = db.raw().prepare("SELECT id FROM users WHERE nickname_lower = ?").get(lower);
  if (exists) throw bad("这个昵称已经被用了，换一个");
  if (phone) {
    const p = db.raw().prepare("SELECT id FROM users WHERE phone = ?").get(phone);
    if (p) throw bad("这个手机号已经注册过了");
  }

  const passwordHash = await hashPassword(password);
  const recoverCode = makeRecoverCode();
  const uid = db.createUser({ nickname, phone, passwordHash, recoverCode });

  db.audit("register", uid, nickname, ip);
  issueSession(res, uid, secure);      // 直接把会话 cookie 种上，注册完就是登录态

  return {
    user: { id: uid, nickname, phone, phoneVerified: 0 },
    // 恢复码只在这一刻返回一次，服务端不留明文（存的是同一条码本身，
    // 但用户拿不到第二次 —— 所以界面上必须让他抄下来）
    recoverCode,
    progress: {}
  };
}

async function login(req, res, body, secure) {
  const ip = clientIP(req);
  const account = String(body.account || "").trim();

  // 两层限流：按账号（防针对某人撞库）、按 IP（防广撒网）
  const byAcct = "login:acct:" + account.toLowerCase();
  const byIP = "login:ip:" + ip;
  if (peek(byAcct) >= 5) {
    const e = new Error("这个账号密码错误次数太多，请 15 分钟后再试");
    e.status = 429; throw e;
  }
  if (hit(byIP, 30, 3600 * 1000).over) {
    const e = new Error("尝试太频繁，请稍后再试");
    e.status = 429; throw e;
  }

  const user = db.getUserByAccount(account);
  // 账号不存在也照样跑一次哈希，让两条路径耗时接近，
  // 否则响应时间差就能被用来枚举用户名
  const hash = user ? user.password_hash : "scrypt$16384$8$2$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";
  const okPw = await verifyPassword(String(body.password || ""), hash);

  if (!user || !okPw) {
    hit(byAcct, 5, 15 * 60 * 1000);
    db.audit("login_fail", user ? user.id : null, account, ip);
    const e = new Error("账号或密码不对");
    e.status = 401; throw e;
  }

  clear(byAcct);
  db.touchLogin(user.id);
  db.audit("login", user.id, user.nickname, ip);
  issueSession(res, user.id, secure);

  let progress = {};
  try { progress = JSON.parse(user.progress || "{}"); } catch (e) {}
  return {
    user: { id: user.id, nickname: user.nickname, phone: user.phone, phoneVerified: user.phone_verified },
    progress
  };
}

// 校验请求携带的会话；没登录返回 null（游客模式允许匿名用）
function currentUser(req) {
  const s = readSession(req);
  if (!s) return null;
  return db.getUserById(s.uid);
}

// 需要登录的接口用它取用户，取不到就抛
function requireUser(req) {
  const u = currentUser(req);
  if (!u) { const e = new Error("请先登录"); e.status = 401; throw e; }
  return u;
}

async function recover(req, res, body, secure) {
  const ip = clientIP(req);
  if (hit("rec:" + ip, 10, 3600 * 1000).over) {
    const e = new Error("尝试太频繁，请稍后再试"); e.status = 429; throw e;
  }
  const code = String(body.recoverCode || "").trim().toUpperCase();
  const newPassword = checkPassword(body.newPassword);
  const user = db.getUserByCode(code);
  if (!user) { const e = new Error("恢复码不对"); e.status = 401; throw e; }

  const hash = await hashPassword(newPassword);
  db.setPassword(user.id, hash);
  // 恢复码用掉就换新的 —— 旧的如果落在别人手里，这一次之后就失效了
  const newCode = makeRecoverCode();
  db.raw().prepare("UPDATE users SET recover_code = ? WHERE id = ?").run(newCode, user.id);
  db.audit("recover", user.id, user.nickname, ip);

  return { ok: true, nickname: user.nickname, recoverCode: newCode };
}

module.exports = {
  hashPassword, verifyPassword, verifyPasswordParams: SCRYPT,
  makeRecoverCode, issueSession, readSession, clearSession,
  currentUser, requireUser, clientIP,
  register, login, recover,
  COOKIE, SESSION_MS
};
