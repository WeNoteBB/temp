/* 通用视频课 · 在服务器上执行 video-seed.sql
   ================================================================
   用法（在 /opt/pet-api 下，.env 已有 DB_PASS）：
     /opt/node-v22/bin/node --env-file=.env seed-videos.mjs

   做两件事：执行同目录的 video-seed.sql（建课程 + 26 条视频目录，幂等），
   然后把插入后的 id / 课名打印出来，方便做 video.html?id=… 的链接。

   注意：这里只导目录信息，不上传视频文件。
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { configFromEnv } from "./server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = path.join(here, "video-seed.sql");
const cfg = configFromEnv();

let sql;
try { sql = fs.readFileSync(sqlFile, "utf8"); }
catch (e) {
  console.error("✗ 读不到 " + sqlFile + "：" + e.message);
  process.exit(1);
}

try {
  const conn = await mysql.createConnection(Object.assign({}, cfg.db, {
    charset: "utf8mb4",
    multipleStatements: true
  }));
  console.log("连接 " + cfg.db.user + "@" + cfg.db.host + ":" + cfg.db.port + "/" + cfg.db.database + " ✓");
  const [results] = await conn.query(sql);
  const sets = Array.isArray(results) ? results : [results];
  const rows = sets[sets.length - 1];
  if (Array.isArray(rows) && rows.length && rows[0] && rows[0].id != null) {
    console.log("\n播放页链接（video.html?id=…）：");
    rows.forEach(function (r) {
      console.log("  " + String(r.seq).padStart(2, "0") + "  id=" + r.id + "  " +
        (r.lesson_type ? "[" + r.lesson_type + "] " : "") + r.lesson_name);
    });
  }
  await conn.end();
  console.log("\n视频目录导入完成。视频文件本身还要上传到 nginx 目录（或 OSS）。");
} catch (e) {
  console.error("\n✗ 导入中断：" + ((e && e.message) || e));
  const msg = String((e && e.message) || "");
  if (/Table .* doesn't exist/i.test(msg)) {
    console.error("  → 表还没建：先跑 node --env-file=.env migrate.mjs（或 mysql < video-tables.sql）");
  }
  if (/Access denied/i.test(msg)) console.error("  → 数据库拒绝了这个账号，检查 .env 的 DB_USER / DB_PASS。");
  process.exit(1);
}
