/* 通用视频课 · 视频目录导入（data/videos.json → edu_course / edu_video）
   ================================================================
   这里导入的是**视频的目录信息**，不是视频文件本身：
     科目 / 年级 / 课程名 → edu_course
     序号 / 课名 / 类型 / 原始文件名 / 播放地址 → edu_video

   用法（在 pet-reading/ 下）：
     node --env-file=server/.env tools/import-videos.mjs --dry
     node --env-file=server/.env tools/import-videos.mjs --write
     node tools/import-videos.mjs --sql > server/video-seed.sql

   --dry   只体检 + 打印计划，不连库
   --write 连 MySQL，按 (subject, grade, name) 找/建课程，按 (course_id, seq) UPSERT 视频
   --sql   不连库，输出可直接执行的 SQL（适合在 ECS 上 mysql < 文件）

   幂等：重复跑只会更新，不会插重。
   视频文件本身要单独上传到 nginx 目录（或 OSS），file_url 指向它。
*/

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data", "videos.json");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const SQL = argv.includes("--sql");
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? argv[outIdx + 1] : "";

const LIMITS = {
  subject: 32,
  grade: 32,
  course: 128,
  lesson: 128,
  type: 16,
  fileName: 255,
  fileUrl: 512
};

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

function text(v) {
  return String(v == null ? "" : v).trim();
}

function joinUrl(prefix, playName) {
  const p = text(prefix).replace(/\/+$/, "");
  const n = text(playName).replace(/^\/+/, "");
  if (!p) return n;
  return p + "/" + n;
}

function sqlStr(v) {
  return "'" + String(v == null ? "" : v)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''")
    .replace(/\u0000/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r") + "'";
}

function checkLen(name, value, max, rowLabel) {
  if (String(value).length > max) {
    die(rowLabel + " 的 " + name + " 太长（" + String(value).length + " > " + max + "）");
  }
}

let D;
try { D = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { die("读不到 " + file + "：" + e.message); }

const course = D.course || {};
const subject = text(course.subject);
const grade = text(course.grade);
const courseName = text(course.name);
if (!subject) die("course.subject 不能为空");
if (!grade) die("course.grade 不能为空");
if (!courseName) die("course.name 不能为空");
checkLen("subject", subject, LIMITS.subject, "course");
checkLen("grade", grade, LIMITS.grade, "course");
checkLen("name", courseName, LIMITS.course, "course");

const urlPrefix = text(D.urlPrefix);
if (urlPrefix && !/^(https?:\/\/|\/)/.test(urlPrefix)) {
  die("urlPrefix 必须以 / 或 http(s):// 开头（现在是 " + urlPrefix + "）");
}

const videos = Array.isArray(D.videos) ? D.videos : [];
if (!videos.length) die("videos 是空的");

const seen = new Set();
const rows = [];
videos.forEach(function (v, i) {
  const label = "第 " + (i + 1) + " 条";
  const seq = parseInt(v && v.seq, 10);
  const lesson = text(v && v.lesson);
  const type = text(v && v.type);
  const fileName = text(v && v.fileName);
  const playName = text(v && v.playName);

  if (!(seq >= 1 && seq <= 65535)) die(label + " 的 seq 不合法（" + (v && v.seq) + "）");
  if (seen.has(seq)) die("seq 重复：" + seq);
  seen.add(seq);
  if (!lesson) die(label + " 缺 lesson");
  if (!fileName) die(label + " 缺 fileName");
  if (!playName) die(label + " 缺 playName");
  if (/\.\.(?:\/|\\|$)/.test(playName)) die(label + " 的 playName 不能包含 ..");

  checkLen("lesson", lesson, LIMITS.lesson, "seq " + seq);
  checkLen("type", type, LIMITS.type, "seq " + seq);
  checkLen("fileName", fileName, LIMITS.fileName, "seq " + seq);

  const fileUrl = joinUrl(urlPrefix, playName);
  if (!fileUrl) die(label + " 算不出 fileUrl");
  checkLen("fileUrl", fileUrl, LIMITS.fileUrl, "seq " + seq);

  rows.push({
    seq: seq,
    lesson: lesson,
    type: type,
    fileName: fileName,
    playName: playName,
    fileUrl: fileUrl
  });
});

rows.sort(function (a, b) { return a.seq - b.seq; });

console.error("data/videos.json：" + rows.length + " 个视频");
console.error("课程：" + [subject, grade, courseName].join(" / "));
console.error("URL 前缀：" + (urlPrefix || "（无，fileUrl 直接用 playName）"));
if (DRY) {
  rows.forEach(function (r) {
    console.error("  " + String(r.seq).padStart(3, " ") + "  " + r.type + "  " + r.lesson +
      "  ←  " + r.fileName + "  →  " + r.fileUrl);
  });
}

function buildSql() {
  const lines = [];
  lines.push("-- 通用视频课 · 目录种子数据（由 tools/import-videos.mjs --sql 生成）");
  lines.push("-- 先跑 server/migrate.mjs 建表，再执行本文件。");
  lines.push("-- 导入的是目录信息，不是视频文件；视频文件放 nginx 目录/OSS。");
  lines.push("");
  lines.push("INSERT INTO `edu_course` (`subject`, `grade`, `name`, `status`) VALUES (" +
    [sqlStr(subject), sqlStr(grade), sqlStr(courseName)].join(", ") + ", 1)");
  lines.push("ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`), `status` = 1;");
  lines.push("SET @course_id = LAST_INSERT_ID();");
  lines.push("");
  lines.push("INSERT INTO `edu_video` (`course_id`, `seq`, `lesson_name`, `lesson_type`, `file_name`, `file_url`, `status`) VALUES");
  lines.push(rows.map(function (r) {
    return "  (@course_id, " + r.seq + ", " + sqlStr(r.lesson) + ", " + sqlStr(r.type) + ", " +
      sqlStr(r.fileName) + ", " + sqlStr(r.fileUrl) + ", 1)";
  }).join(",\n") + "\nON DUPLICATE KEY UPDATE");
  lines.push("  `lesson_name` = VALUES(`lesson_name`),");
  lines.push("  `lesson_type` = VALUES(`lesson_type`),");
  lines.push("  `file_name` = VALUES(`file_name`),");
  lines.push("  `file_url` = VALUES(`file_url`),");
  lines.push("  `status` = 1;");
  lines.push("");
  lines.push("-- 播放页 URL 用的是 edu_video.id；下面这条会打印 id 与课名，方便做链接");
  lines.push("SELECT `id`, `seq`, `lesson_name`, `lesson_type` FROM `edu_video` WHERE `course_id` = @course_id ORDER BY `seq`;");
  lines.push("");
  return lines.join("\n");
}

if (SQL) {
  const body = buildSql();
  if (OUT) {
    const out = path.resolve(process.cwd(), OUT);
    fs.writeFileSync(out, body, "utf8");
    console.error("SQL 已写出：" + out);
  } else {
    process.stdout.write(body);
  }
  process.exit(0);
}

if (DRY) {
  console.error("\n（--dry）体检通过；要真写库加 --write，要生成 SQL 加 --sql --out server/video-seed.sql");
  process.exit(0);
}

/* ---------- 真写库 ---------- */
const { configFromEnv } = await import("../server/server.mjs");
const { createPool } = await import("../server/db.mjs");
const cfg = configFromEnv();
const pool = createPool(cfg.db);

try {
  await pool.query("SELECT 1");
  console.log("连接 " + cfg.db.user + "@" + cfg.db.host + ":" + cfg.db.port + "/" + cfg.db.database + " ✓");

  const [c] = await pool.query(
    "INSERT INTO `edu_course` (`subject`, `grade`, `name`, `status`) VALUES (?, ?, ?, 1) " +
      "ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`), `status` = 1",
    [subject, grade, courseName]
  );
  const courseId = c.insertId;
  console.log("课程 edu_course.id = " + courseId + "：" + [subject, grade, courseName].join(" / "));

  for (const r of rows) {
    await pool.query(
      "INSERT INTO `edu_video` (`course_id`, `seq`, `lesson_name`, `lesson_type`, `file_name`, `file_url`, `status`) " +
        "VALUES (?, ?, ?, ?, ?, ?, 1) " +
        "ON DUPLICATE KEY UPDATE `lesson_name` = VALUES(`lesson_name`), `lesson_type` = VALUES(`lesson_type`), " +
        "`file_name` = VALUES(`file_name`), `file_url` = VALUES(`file_url`), `status` = 1",
      [courseId, r.seq, r.lesson, r.type, r.fileName, r.fileUrl]
    );
  }

  const [n] = await pool.query("SELECT COUNT(*) AS n FROM `edu_video` WHERE `course_id` = ?", [courseId]);
  console.log("导入完成：" + rows.length + " 条；该课程现在共 " + n[0].n + " 个视频");
  const [vids] = await pool.query(
    "SELECT `id`, `seq`, `lesson_name`, `lesson_type` FROM `edu_video` WHERE `course_id` = ? ORDER BY `seq`",
    [courseId]
  );
  console.log("播放页链接（video.html?id=…）：");
  vids.forEach(function (v) {
    console.log("  " + String(v.seq).padStart(2, "0") + "  id=" + v.id + "  " +
      (v.lesson_type ? "[" + v.lesson_type + "] " : "") + v.lesson_name);
  });
  await pool.end();
} catch (e) {
  console.error("\n✗ 导入中断：" + ((e && e.message) || e));
  const msg = String((e && e.message) || "");
  if (/Table .* doesn't exist/i.test(msg)) console.error("  → 表还没建：先跑 node --env-file=server/.env server/migrate.mjs");
  if (/Access denied/i.test(msg)) console.error("  → 数据库拒绝了这个来源 IP / 账号，检查 server/.env。");
  process.exit(1);
}
