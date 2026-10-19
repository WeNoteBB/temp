/* PET 精读 · 词组库导入（data/phrases.json → pet_phrase）
   ================================================================
   内容真源是 data/phrases.json（进 git、可审、可导出）；这张表是**镜像**，
   给「用户词组表 join / 统计哪个词组被收藏、错得最多」用。

   用法（在能连上 MySQL 的机器上跑）：
     node --env-file=server/.env tools/import-phrases.mjs          真的写
     node --env-file=server/.env tools/import-phrases.mjs --dry    只打印会做什么

   幂等：按 uk_phrase_no（序号）和 uk_phrase_text（词组）双唯一键 UPSERT，
   重复跑只会把内容更新到最新，不会插重。
*/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { configFromEnv } from "../server/server.mjs";
import { createPool } from "../server/db.mjs";
import { fitText, fitChars } from "../server/lib.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");
const file = path.join(root, "data", "phrases.json");

let D;
try { D = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) {
  console.error("✗ 读不到 " + file + "：" + e.message);
  process.exit(1);
}
const items = (Array.isArray(D.items) ? D.items : []).filter(x => x && x.ph);
console.log("data/phrases.json：" + items.length + " 条词组" + (DRY ? "（--dry：只看不做）" : ""));

/* 入库前的字段体检：真源里缺什么，这里就报什么 —— 别让空字段悄悄进库。
   ⚠ 放在连库之前：内容有问题时不该先连数据库。 */
const bad = [];
items.forEach(it => {
  const problems = [];
  if (!it.n) problems.push("缺序号 n");
  if (!it.cn) problems.push("缺中文 cn");
  if (!it.ex) problems.push("缺例句 ex");
  if (!it.exCn) problems.push("缺例句翻译 exCn");
  if (!it.why) problems.push("缺答案分析 why");
  if (it.blank && it.ex && it.ex.toLowerCase().indexOf(String(it.blank).toLowerCase()) < 0) {
    problems.push("blank 不是 ex 的子串");
  }
  if (problems.length) bad.push("  ✗ " + (it.n || "?") + " " + it.ph + "：" + problems.join("、"));
});
if (bad.length) {
  console.log("\n这些条目不干净，先修 data/phrases.json：\n" + bad.join("\n"));
  process.exit(1);
}
console.log("字段体检通过（序号/中文/例句/翻译/答案分析都在，blank 都是例句的子串）\n");

const cfg = configFromEnv();
const pool = createPool(cfg.db);
let okN = 0;

try {
  await pool.query("SELECT 1");
  console.log("连接 " + cfg.db.user + "@" + cfg.db.host + ":" + cfg.db.port + "/" + cfg.db.database + " ✓\n");

  for (const it of items) {
    const row = [
      it.n,
      Math.max(1, Math.ceil(it.n / 10)),
      fitChars(it.ph, 128),
      fitChars(it.alt || "", 128),
      fitText(it.cn || ""),
      fitText(it.use || ""),
      fitText(it.ex || ""),
      fitText(it.exCn || ""),
      fitChars(it.blank || "", 128),
      it.why ? JSON.stringify({ why: it.why, trap: it.trap || "" }) : null
    ];
    if (!DRY) {
      await pool.query(
        "INSERT INTO `pet_phrase` " +
          "(`no`, `grp`, `phrase`, `alt`, `meaning`, `usage_note`, `example`, `example_cn`, `blank`, `quest`, `status`) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) " +
          "ON DUPLICATE KEY UPDATE `grp` = VALUES(`grp`), `phrase` = VALUES(`phrase`), `alt` = VALUES(`alt`), " +
          "`meaning` = VALUES(`meaning`), `usage_note` = VALUES(`usage_note`), `example` = VALUES(`example`), " +
          "`example_cn` = VALUES(`example_cn`), `blank` = VALUES(`blank`), `quest` = VALUES(`quest`), `status` = 1",
        row
      );
    }
    okN++;
  }

  if (!DRY) {
    const [r] = await pool.query("SELECT COUNT(*) AS n FROM `pet_phrase`");
    console.log("\npet_phrase 现在共 " + r[0].n + " 行");
  }
  await pool.end();
  console.log((DRY ? "（--dry）可导入 " : "导入完成：") + okN + " 条");
} catch (e) {
  console.error("\n✗ 导入中断：" + ((e && e.message) || e));
  const msg = String((e && e.message) || "");
  if (/Table .* doesn't exist/i.test(msg)) console.error("  → pet_phrase 还没建：先跑 node --env-file=server/.env server/migrate.mjs");
  if (/Access denied/i.test(msg)) console.error("  → 数据库拒绝了这个来源 IP / 账号，检查 server/.env。");
  process.exit(1);
}
