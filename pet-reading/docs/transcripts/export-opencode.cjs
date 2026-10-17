#!/usr/bin/env node
/* 从 OpenCode 的 opencode.db 导出「某个工作目录下最近一场会话」：
   - <日期>-pet-reading.jsonl.gz   原始转写（全部消息，含工具调用/推理）
   - <日期>-pet-reading.md         纯文字版（用户消息 + 助手正文 + 工具名单 + 压缩摘要）
   用法：
     node export-opencode.cjs ["工作目录"] ["输出目录"]
   默认工作目录 = C:/Users/89300/Desktop/pet/book1，输出 = 脚本所在目录。
   Node 22.5+ 自带 node:sqlite，无需装依赖。 */
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DB = process.env.OPENCODE_DB ||
  path.join(process.env.USERPROFILE || process.env.HOME || ".", ".local", "share", "opencode", "opencode.db");
const WORKDIR = process.argv[2] || "C:/Users/89300/Desktop/pet/book1";
const OUTDIR = process.argv[3] || __dirname;

const norm = p => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const db = new DatabaseSync(DB, { readOnly: true });

/* 1. 找会话：目录匹配 + 最近更新（找不到就退到全库最近） */
const all = db.prepare("select * from session_v2 order by time_updated desc").all();
const want = norm(WORKDIR);
const sess = all.find(s => norm(s.directory) === want) || all[0];
if (!sess) { console.error("✗ 数据库里没有会话"); process.exit(1); }

/* 2. 拉消息 */
const rows = db.prepare(
  "select id, type, seq, time_created, data from session_message where session_id=? order by seq, time_created"
).all(sess.id);
db.close();
if (!rows.length) { console.error("✗ 这场会话没有消息"); process.exit(1); }

const fmtTime = ms => {
  const d = new Date(+ms);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const lastMs = Math.max(...rows.map(r => +r.time_created));
const firstMs = Math.min(...rows.map(r => +r.time_created));
const date = fmtTime(lastMs).slice(0, 10);
const base = path.join(OUTDIR, date + "-pet-reading");

/* 3. 原始 JSONL（每行一条，含元数据头行）→ gzip */
const lines = [JSON.stringify({
  kind: "session", id: sess.id, directory: sess.directory, title: sess.title,
  model: sess.model, created: fmtTime(firstMs), updated: fmtTime(lastMs)
})];
rows.forEach(r => lines.push(JSON.stringify({
  id: r.id, type: r.type, seq: r.seq, time: fmtTime(r.time_created), data: JSON.parse(r.data)
})));
fs.writeFileSync(base + ".jsonl.gz", zlib.gzipSync(Buffer.from(lines.join("\n"), "utf8"), { level: 9 }));

/* 4. 纯文字版 md */
let md = `# 会话存档 · ${sess.title || sess.id}\n\n`;
md += `- 工作目录：${sess.directory}\n- 会话 ID：${sess.id}\n- 时间：${fmtTime(firstMs)} → ${fmtTime(lastMs)}\n`;
md += `- 消息：${rows.filter(r => r.type === "user").length} 条用户 + ${rows.filter(r => r.type === "assistant").length} 条助手（推理与工具输出略，见 .jsonl.gz）\n\n`;

/* 压缩摘要（自动 compaction）放最前 */
for (const r of rows) {
  if (r.type !== "compaction") continue;
  const d = JSON.parse(r.data);
  md += `## 📦 会话压缩摘要（自动生成 · ${fmtTime(r.time_created)}）\n\n${d.summary || ""}\n\n---\n`;
}

rowLoop:
for (const r of rows) {
  const d = JSON.parse(r.data);
  if (r.type === "user") {
    md += `\n## 👤 用户 · ${fmtTime(r.time_created)}\n\n${d.text || ""}\n`;
  } else if (r.type === "assistant") {
    const texts = [];
    const tools = {};
    for (const c of (d.content || [])) {
      if (c.type === "text" && c.text) texts.push(c.text);
      else if (c.type === "tool" && c.name) tools[c.name] = (tools[c.name] || 0) + 1;
    }
    const tline = Object.keys(tools).length
      ? "\n\n> 工具：" + Object.entries(tools).map(([k, v]) => `${k}×${v}`).join(", ")
      : "";
    if (!texts.length && !tline) continue rowLoop;   // 纯工具轮（无正文）：文字版略过
    md += `\n## 🤖 助手 · ${fmtTime(r.time_created)}\n\n${texts.join("\n\n")}${tline}\n`;
  }
  /* idle / synthetic / system / compaction 不进正文流水 */
}
fs.writeFileSync(base + ".md", md, "utf8");

console.log("✓ 导出完成");
console.log("  " + base + ".jsonl.gz  (" + (fs.statSync(base + ".jsonl.gz").size / 1024 / 1024).toFixed(2) + " MB)");
console.log("  " + base + ".md        (" + (fs.statSync(base + ".md").size / 1024).toFixed(0) + " KB)");
