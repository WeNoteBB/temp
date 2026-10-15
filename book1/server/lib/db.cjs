/* ============================================================
   数据库层 —— Node 24 内置的 node:sqlite，零 npm 依赖

   为什么用 SQLite 而不是 MySQL：
     1 万用户、每人几 KB、读多写少 —— 这是 SQLite 的主场。
     零运维、零内存压力（MySQL 调优后也要 300-500MB）。
     真到要多机部署那天再迁，数据结构直接搬。

   所有 SQL 一律走参数化（prepare + run/get/all），
   绝不用字符串拼 SQL —— 这是防注入的唯一正确姿势。
   ============================================================ */
"use strict";

const path = require("path");
const fs = require("fs");

const DB_FILE = path.join(__dirname, "..", "data", "pet.db");

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname       TEXT    NOT NULL,
  nickname_lower TEXT    UNIQUE NOT NULL,   -- 小写版，防止 Tom / tom 重复注册
  phone          TEXT    UNIQUE,            -- 手机号（暂不验证）
  phone_verified INTEGER NOT NULL DEFAULT 0,
  password_hash  TEXT    NOT NULL,          -- scrypt，格式见 auth.cjs
  recover_code   TEXT    UNIQUE NOT NULL,   -- 密码找回 / 换设备同步，一码两用
  progress       TEXT    NOT NULL DEFAULT '{}',
  progress_at    TEXT,                      -- 进度最后更新时间
  created_at     TEXT    NOT NULL,
  last_login     TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- 会话存库里而不是内存里：进程重启后用户不用重新登录
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,          -- 32 字节随机数的 hex
  uid        INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- 审计日志：登录、注册、改密都记一笔，出事了能查
CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,      -- register / login / login_fail / logout / recover
  uid     INTEGER,
  account TEXT,               -- 昵称或手机号（不存密码，永远不存）
  ip      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);
`;

function nowISO() {
  return new Date().toISOString();
}

function init() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  // node:sqlite 在 24 里还标着 experimental，会打一行警告。
  // 它是有意为之的，不是错误，但刷屏很难看，这里静音掉。
  const origWarn = process.emitWarning;
  process.emitWarning = function (w, ...rest) {
    if (typeof w === "string" && /SQLite is an experimental feature/.test(w)) return;
    return origWarn.call(process, w, ...rest);
  };
  const { DatabaseSync } = require("node:sqlite");
  db = new DatabaseSync(DB_FILE);
  process.emitWarning = origWarn;

  db.exec("PRAGMA journal_mode = WAL");     // 并发读不被写阻塞
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");    // 写冲突时等 5 秒而不是直接报错
  db.exec(SCHEMA);
  return db;
}

function raw() {
  if (!db) throw new Error("数据库还没初始化，先调 db.init()");
  return db;
}

/* ---------- 用户 ---------- */
const U_COLS = "id,nickname,phone,phone_verified,recover_code,progress,progress_at,created_at,last_login";

const q = {
  byId:      () => "SELECT " + U_COLS + " FROM users WHERE id = ?",
  byNick:    () => "SELECT " + U_COLS + ",password_hash FROM users WHERE nickname_lower = ?",
  byPhone:   () => "SELECT " + U_COLS + ",password_hash FROM users WHERE phone = ?",
  byAccount: () => "SELECT " + U_COLS + ",password_hash FROM users WHERE nickname_lower = ? OR (phone IS NOT NULL AND phone = ?)",
  byCode:    () => "SELECT " + U_COLS + " FROM users WHERE recover_code = ?"
};
// 注意 recover_code 列里存的是 SHA-256 摘要，不是码本身。
// 这样即使库被拖走，也不能拿去重置别人的密码。

function getUserById(id) {
  return raw().prepare(q.byId()).get(id) || null;
}

// 登录用：昵称或手机号都能登 —— 用户记不住自己注册时叫啥是常态
function getUserByAccount(account) {
  const a = String(account || "").trim();
  return raw().prepare(q.byAccount()).get(a.toLowerCase(), a) || null;
}

function getUserByCode(code) {
  return raw().prepare(q.byCode()).get(String(code || "").trim().toUpperCase()) || null;
}

function createUser(u) {
  const st = raw().prepare(
    "INSERT INTO users (nickname,nickname_lower,phone,password_hash,recover_code,progress,created_at) " +
    "VALUES (?,?,?,?,?,'{}',?)"
  );
  const info = st.run(
    u.nickname, u.nickname.toLowerCase(), u.phone || null,
    u.passwordHash, u.recoverCode, nowISO()
  );
  return Number(info.lastInsertRowid);
}

function setPassword(uid, passwordHash) {
  raw().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, uid);
}

function setPhone(uid, phone) {
  raw().prepare("UPDATE users SET phone = ?, phone_verified = 0 WHERE id = ?").run(phone, uid);
}

function touchLogin(uid) {
  raw().prepare("UPDATE users SET last_login = ? WHERE id = ?").run(nowISO(), uid);
}

function saveProgress(uid, progressJson) {
  raw().prepare("UPDATE users SET progress = ?, progress_at = ? WHERE id = ?")
    .run(progressJson, nowISO(), uid);
}

function deleteUser(uid) {
  // 合规要求：用户要能注销。真删，不做软删除。
  raw().prepare("DELETE FROM sessions WHERE uid = ?").run(uid);
  raw().prepare("DELETE FROM users WHERE id = ?").run(uid);
}

/* ---------- 会话 ---------- */
function createSession(token, uid, expiresAt) {
  raw().prepare("INSERT INTO sessions (token,uid,created_at,expires_at) VALUES (?,?,?,?)")
    .run(token, uid, nowISO(), expiresAt);
}

function getSession(token) {
  const s = raw().prepare("SELECT token,uid,expires_at FROM sessions WHERE token = ?").get(token);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    raw().prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return s;
}

function dropSession(token) {
  raw().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function purgeSessions() {
  const info = raw().prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowISO());
  return Number(info.changes || 0);
}

/* ---------- 审计 ---------- */
function audit(kind, uid, account, ip) {
  try {
    raw().prepare("INSERT INTO audit (at,kind,uid,account,ip) VALUES (?,?,?,?,?)")
      .run(nowISO(), kind, uid || null, account || null, ip || null);
  } catch (e) {
    // 审计写失败不能影响主流程
    console.error("审计写入失败：" + e.message);
  }
}

/* ---------- 备份 ----------
   SQLite 的好处之一：备份就是复制一个文件。
   用 VACUUM INTO 而不是 cp，因为 WAL 模式下直接复制可能拿到不一致的快照。 */
function backup(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, "pet-" + new Date().toISOString().slice(0, 10) + ".db");
  raw().exec("VACUUM INTO '" + dst.replace(/'/g, "''") + "'");
  return dst;
}

module.exports = {
  init, raw, nowISO,
  getUserById, getUserByAccount, getUserByCode,
  createUser, setPassword, setPhone, touchLogin, saveProgress, deleteUser,
  createSession, getSession, dropSession, purgeSessions,
  audit, backup, DB_FILE
};
