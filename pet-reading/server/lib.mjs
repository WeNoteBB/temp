/* PET 精读后端 · 纯函数工具（无依赖，可直接单测）
   =============================================================== */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const PHONE_RE = /^1[3-9]\d{9}$/;

/* 昵称 / 密码的长度口径（前端 store.js 里有一份同样的，改动要同步）：
   昵称 1–16 个字符（varchar(32) 留中文双字节余量），密码 6–64 个字符。 */
export const NICK_MAX = 16;
export const PASS_MIN = 6;
export const PASS_MAX = 64;

/* slug 口径：小写字母/数字/连字符，与 build.mjs、文章文件命名一致 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* pet_word.word 是 varchar(64)，按字符数算 */
export const WORD_MAX = 64;

/* TEXT 列上限 65535 字节（utf8mb4 最多 4 字节/字），留点余量。
   超长的释义/分析就截断——截断比 500 报错、比把学生收藏卡死强。 */
export const TEXT_MAX_BYTES = 60000;

export const TITLE_MAX = 255;

export function normPhone(v) {
  return String(v == null ? "" : v).replace(/[\s-]/g, "");
}

export function validPhone(v) {
  return PHONE_RE.test(normPhone(v));
}

export function normWord(v) {
  return String(v == null ? "" : v).trim();
}

/* ---------- 注册 / 登录 ---------- */

/* 昵称：去掉控制字符再 trim。空串 / 超长都算不合法（服务端拦，前端也拦一遍）。 */
export function normNickname(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
export function validNickname(v) {
  const s = normNickname(v);
  return s.length >= 1 && s.length <= NICK_MAX;
}

/* 密码：只限制长度，不做字符白名单（允许中文/符号，省得用户被莫名其妙的规则卡住） */
export function validPassword(v) {
  const s = String(v == null ? "" : v);
  return s.length >= PASS_MIN && s.length <= PASS_MAX;
}

/* 密码散列：scrypt（加盐、固定参数），格式 "scrypt$<盐hex>$<散列hex>"。
   不引第三方依赖 —— node 自带的 scryptSync 就够用，也省掉 bcrypt 的原生编译。
   ⚠ 这是「能验证密码」的最低标准，不是完整的安全体系：
     本项目其余接口仍按手机号认人（软认证），口令只用于「别把密码原文存库」。 */
export function hashPassword(pw) {
  const salt = randomBytes(12).toString("hex");
  const hash = scryptSync(String(pw), salt, 32).toString("hex");
  return "scrypt$" + salt + "$" + hash;
}

/* 校验密码。格式不对 / 盐坏了都返回 false，绝不抛异常（登录接口不该被脏数据打 500）。 */
export function verifyPassword(pw, stored) {
  const parts = String(stored == null ? "" : stored).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let got;
  try { got = scryptSync(String(pw), parts[1], 32); } catch (e) { return false; }
  let want;
  try { want = Buffer.from(parts[2], "hex"); } catch (e) { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ---------- 等级颜色（1–18：蓝 → 金） ----------
   色相 217°（蓝）线性走到 45°（金），中途经过青 / 绿 / 黄绿 ——
   比直接 RGB 插值漂亮得多（那个中段会发灰）。
   种子值由 migrate.mjs 写进 pet_user_level 表；
   这里留一份同源拷贝，表里查不到 / 等级超界时兜底。两处只允许 migrate 从这里取。 */
export const LEVEL_COLORS = [
  "#3171d8", "#318dd8", "#31a9d8", "#31c5d8", "#31d8ce", "#31d8b2",
  "#31d896", "#31d87a", "#31d85e", "#31d842", "#3dd831", "#59d831",
  "#75d831", "#91d831", "#add831", "#c9d831", "#d8ca31", "#d8ae31"
];

export function levelColor(level) {
  let n = parseInt(level, 10);
  if (!(n >= 1)) n = 1;
  if (n > LEVEL_COLORS.length) n = LEVEL_COLORS.length;
  return LEVEL_COLORS[n - 1];
}

/* 句子的唯一形状：只 trim，不折叠中间空格 —— 客户端入库前也用同一条规则，
   两端对不上就会出现「同一句话在手机和电脑上各是一条收藏」。 */
export function normSentence(v) {
  return String(v == null ? "" : v).trim();
}

/* pet_sentence.hash：sha256(utf8(trim 后的句子))，64 位小写十六进制 */
export function sha256Hex(v) {
  return createHash("sha256").update(String(v), "utf8").digest("hex");
}

/* 按 UTF-8 字节数截断，保证不切碎多字节字符 */
export function fitText(v, maxBytes) {
  const s = String(v == null ? "" : v);
  const cap = maxBytes || TEXT_MAX_BYTES;
  if (Buffer.byteLength(s, "utf8") <= cap) return s;
  let cut = s;
  while (cut.length && Buffer.byteLength(cut, "utf8") > cap) {
    cut = cut.slice(0, cut.length - 1);
  }
  return cut;
}

/* 按「字符数」截断 —— varchar(n) 是按字符数算的，别拿 fitText（字节）混用 */
export function fitChars(v, n) {
  const s = String(v == null ? "" : v);
  return s.length > n ? s.slice(0, n) : s;
}

export function byteLen(v) {
  return Buffer.byteLength(String(v == null ? "" : v), "utf8");
}
