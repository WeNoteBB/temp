/* PET 精读 · 数据库迁移（幂等，可以反复跑）
   ================================================================
   干三件事：
     ① 建 pet_user_level 表，写入 18 行等级颜色（1=蓝 … 18=金）
     ② 给 user 表加三列：nickname / pass_hash / user_level（已经有了就跳过）
     ③ 建 pet_mistake 错题记录表

   用法（在能连上 MySQL 的机器上跑，比如部署后的 ECS）：
     node --env-file=.env migrate.mjs         真的执行
     node --env-file=.env migrate.mjs --dry   只打印会做什么，不动库

   为什么粘着一堆 information_schema 查询：
     MySQL 没有 "ADD COLUMN IF NOT EXISTS"（那是 MariaDB 的语法），
     靠它判断列在不在，脚本才能反复安全地跑。
*/

import { configFromEnv } from "./server.mjs";
import { createPool } from "./db.mjs";
import { LEVEL_COLORS } from "./lib.mjs";

const DRY = process.argv.includes("--dry");
const cfg = configFromEnv();
const pool = createPool(cfg.db);

let changed = 0, skipped = 0;
const log  = (m) => console.log("  ✓ " + m);
const skip = (m) => { skipped++; console.log("  · " + m); };
const plan = (m) => console.log("  → " + m);

async function tableExists(name) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name = ?", [name]);
  return rows[0].n > 0;
}

async function columnExists(table, col) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns " +
      "WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", [table, col]);
  return rows[0].n > 0;
}

try {
  console.log("连接 " + cfg.db.user + "@" + cfg.db.host + ":" + cfg.db.port + "/" + cfg.db.database + " …");
  await pool.query("SELECT 1");
  console.log("数据库连通 ✓" + (DRY ? "（--dry：只看不做）\n" : "\n"));

  /* ---------- ① pet_user_level ---------- */
  if (await tableExists("pet_user_level")) {
    skip("表 pet_user_level 已存在");
  } else {
    plan("建表 pet_user_level（level / color）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `pet_user_level` (" +
          "`level` TINYINT UNSIGNED NOT NULL COMMENT '等级 1-18'," +
          "`color` CHAR(7) NOT NULL COMMENT '等级颜色 #RRGGBB'," +
          "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`level`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户等级颜色表'");
      log("建表 pet_user_level");
      changed++;
    }
  }
  /* 种子值：一张一张 UPSERT。色值是我们自己的常量，直接拼进 SQL；重复跑只更新颜色，
     不重置 level（表就 18 行，真被改过颜色的话重跑会把颜色拉回标准值，这正是想要的）。 */
  for (let i = 0; i < LEVEL_COLORS.length; i++) {
    const lv = i + 1, color = LEVEL_COLORS[i];
    if (!DRY) {
      await pool.query(
        "INSERT INTO `pet_user_level` (`level`, `color`) VALUES (?, ?) " +
          "ON DUPLICATE KEY UPDATE `color` = ?", [lv, color, color]);
    }
  }
  log("等级颜色 18 行已写入（1=" + LEVEL_COLORS[0] + " … 18=" + LEVEL_COLORS[17] + "）");

  /* ---------- ② user 表加列 ---------- */
  const newCols = [
    ["nickname", "VARCHAR(32) NOT NULL DEFAULT '' COMMENT '昵称'"],
    ["pass_hash", "VARCHAR(128) NOT NULL DEFAULT '' COMMENT '密码散列 scrypt$盐$散列'"],
    ["user_level", "TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '用户等级 1-18，颜色查 pet_user_level'"]
  ];
  for (const [col, def] of newCols) {
    if (await columnExists("user", col)) { skip("user." + col + " 已存在"); continue; }
    plan("user 加列 " + col);
    if (!DRY) {
      await pool.query("ALTER TABLE `user` ADD COLUMN `" + col + "` " + def);
      log("user 加列 " + col);
      changed++;
    }
  }
  /* 老的软登录用户等级可能是 0 / NULL，统一拉到 1（不然圆圈没有颜色） */
  if (!DRY && await columnExists("user", "user_level")) {
    const [r] = await pool.query("UPDATE `user` SET `user_level` = 1 WHERE `user_level` < 1");
    if (r.affectedRows) { log("把 " + r.affectedRows + " 行 user_level < 1 的用户拉到 1 级"); changed++; }
  }

  /* ---------- ③ pet_mistake ---------- */
  if (await tableExists("pet_mistake")) {
    skip("表 pet_mistake 已存在");
  } else {
    plan("建表 pet_mistake（user_id + slug + 题号 唯一）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `pet_mistake` (" +
          "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
          "`user_id` BIGINT UNSIGNED NOT NULL COMMENT 'user.id'," +
          "`slug` VARCHAR(64) NOT NULL COMMENT '文章 slug'," +
          "`q_n` TINYINT UNSIGNED NOT NULL COMMENT '题号（16-20）'," +
          "`chosen` CHAR(1) NOT NULL COMMENT '学生选错的那个选项'," +
          "`correct` CHAR(1) NOT NULL COMMENT '正确答案选项'," +
          "`wrong_count` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '同题错了几次'," +
          "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
          "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`id`)," +
          "UNIQUE KEY `uk_mistake` (`user_id`, `slug`, `q_n`)," +
          "KEY `idx_mistake_user` (`user_id`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PET 阅读理解错题记录'");
      log("建表 pet_mistake");
      changed++;
    }
  }

  await pool.end();
  console.log("\n" + (DRY ? "（--dry）以上是从现在到目标状态要做的事" :
    (changed ? "迁移完成：" + changed + " 处改动，" + skipped + " 处已是目标状态" :
      "数据库已经是目标状态，无需改动")));
} catch (e) {
  console.error("\n✗ 迁移中断：" + ((e && e.message) || e));
  const msg = String((e && e.message) || "");
  if (/Access denied/i.test(msg)) {
    console.error("  → 数据库拒绝了这个来源 IP / 账号。检查 .env 里的 DB_USER / DB_PASS / DB_HOST。");
  }
  if (!cfg.db.password || cfg.db.password === "在这里填密码") {
    console.error("  → DB_PASS 还没配置。参照 server/.env.example 把 .env 填好再用 `node --env-file=.env migrate.mjs` 跑。");
  }
  process.exit(1);
}
