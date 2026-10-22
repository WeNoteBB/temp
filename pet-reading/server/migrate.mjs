/* PET 精读 · 数据库迁移（幂等，可以反复跑）
   ================================================================
   干这些事：
     ① 建 pet_user_level 表，写入 18 行等级颜色（1=蓝 … 18=金）
     ② 给 user 表加三列：nickname / pass_hash / user_level（已经有了就跳过）
     ③ 建 pet_mistake 错题记录表（阅读理解）
     ④ 建词组库三张表：pet_phrase（内容镜像）/ user_phrase（用户收藏）/ pet_phrase_mistake（词组错题）
     ⑤ 建 pet_phrase_review 词组复习表（间隔重复：等级 1-6 → 1/2/4/7/15/30 天）
     ⑥ 建通用视频课三张表：edu_course / edu_video / edu_video_progress（不绑 PET）

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

  /* ---------- ④ 词组库三张表（词组 / 用户收藏 / 词组错题） ---------- */
  if (await tableExists("pet_phrase")) {
    skip("表 pet_phrase 已存在");
  } else {
    plan("建表 pet_phrase（词组库内容镜像：真源是 data/phrases.json）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `pet_phrase` (" +
          "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
          "`no` SMALLINT UNSIGNED NOT NULL COMMENT '书上序号 1-254'," +
          "`grp` TINYINT UNSIGNED NOT NULL COMMENT '组号（10 个一组）'," +
          "`phrase` VARCHAR(128) NOT NULL COMMENT '词组'," +
          "`alt` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '等价说法（= groups of）'," +
          "`meaning` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '中文意思'," +
          "`usage_note` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '用法（中文提示）'," +
          "`example` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '例句'," +
          "`example_cn` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '例句翻译'," +
          "`blank` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '题干里挖掉的那一块'," +
          "`quest` JSON NULL COMMENT '答案分析：{why, trap}'," +
          "`status` TINYINT NOT NULL DEFAULT 0 COMMENT '0 草稿 / 1 已审'," +
          "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
          "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`id`)," +
          "UNIQUE KEY `uk_phrase_no` (`no`)," +
          "UNIQUE KEY `uk_phrase_text` (`phrase`)," +
          "KEY `idx_phrase_grp` (`grp`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PET 词组库（内容镜像，真源 data/phrases.json）'");
      log("建表 pet_phrase");
      changed++;
    }
  }

  if (await tableExists("user_phrase")) {
    skip("表 user_phrase 已存在");
  } else {
    plan("建表 user_phrase（用户收藏的词组：词组/中文/例句/例句翻译 都带快照）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `user_phrase` (" +
          "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
          "`user_id` BIGINT UNSIGNED NOT NULL COMMENT 'user.id'," +
          "`phrase_id` BIGINT UNSIGNED NOT NULL COMMENT 'pet_phrase.id'," +
          "`level` VARCHAR(16) NOT NULL DEFAULT 'PET' COMMENT '等级'," +
          "`phrase` VARCHAR(128) NOT NULL COMMENT '词组（快照）'," +
          "`meaning` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '中文意思（快照）'," +
          "`example` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '例句（快照）'," +
          "`example_cn` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '例句翻译（快照）'," +
          "`source_type` TINYINT NOT NULL DEFAULT 3 COMMENT '3=词组'," +
          "`source_title` VARCHAR(255) NULL COMMENT '来源（哪本书）'," +
          "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`id`)," +
          "UNIQUE KEY `uk_user_phrase` (`user_id`, `level`, `phrase_id`)," +
          "KEY `idx_user_phrase_user` (`user_id`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户收藏的词组（带内容快照）'");
      log("建表 user_phrase");
      changed++;
    }
  }

  if (await tableExists("pet_phrase_mistake")) {
    skip("表 pet_phrase_mistake 已存在");
  } else {    plan("建表 pet_phrase_mistake（用户id + 原题 + 选择项，同题重复错只计数）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `pet_phrase_mistake` (" +
          "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
          "`user_id` BIGINT UNSIGNED NOT NULL COMMENT 'user.id'," +
          "`phrase_id` BIGINT UNSIGNED NOT NULL COMMENT 'pet_phrase.id'," +
          "`phrase_no` SMALLINT UNSIGNED NOT NULL COMMENT '书上序号'," +
          "`phrase` VARCHAR(128) NOT NULL COMMENT '词组（快照）'," +
          "`stem` VARCHAR(512) NOT NULL COMMENT '原题（挖空后的句子）'," +
          "`chosen` VARCHAR(128) NOT NULL COMMENT '学生选的那个（选项文本）'," +
          "`chosen_k` CHAR(1) NOT NULL DEFAULT '' COMMENT '选项字母（词组题没有字母，留空）'," +
          "`correct` VARCHAR(128) NOT NULL COMMENT '正确选项文本'," +
          "`correct_k` CHAR(1) NOT NULL DEFAULT '' COMMENT '正确选项字母'," +
          "`wrong_count` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '同题错了几次'," +
          "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
          "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`id`)," +
          "UNIQUE KEY `uk_ph_mistake` (`user_id`, `phrase_id`)," +
          "KEY `idx_ph_mistake_user` (`user_id`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='词组选择题错题记录'");
      log("建表 pet_phrase_mistake");
      changed++;
    }
  }

  /* ---------- ⑤ pet_phrase_review（词组复习的间隔重复） ---------- */
  if (await tableExists("pet_phrase_review")) {
    skip("表 pet_phrase_review 已存在");
  } else {
    plan("建表 pet_phrase_review（user_id + 词组 + 等级 + 到期日，间隔重复）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `pet_phrase_review` (" +
          "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
          "`user_id` BIGINT UNSIGNED NOT NULL COMMENT 'user.id'," +
          "`phrase_id` BIGINT UNSIGNED NOT NULL COMMENT 'pet_phrase.id'," +
          "`phrase_no` SMALLINT UNSIGNED NOT NULL COMMENT '书上序号'," +
          "`phrase` VARCHAR(128) NOT NULL COMMENT '词组（快照）'," +
          "`level` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '复习等级 1-6（间隔 1/2/4/7/15/30 天）'," +
          "`reps` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '一共复习过几次'," +
          "`wrongs` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '其中错过几次'," +
          "`due_at` DATE NOT NULL COMMENT '下次到期日（当天 0 点起算）'," +
          "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
          "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`id`)," +
          "UNIQUE KEY `uk_phrase_review` (`user_id`, `phrase_id`)," +
          "KEY `idx_review_due` (`user_id`, `due_at`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='词组复习（间隔重复）'");
      log("建表 pet_phrase_review");
      changed++;
    }
  }

  /* ---------- ⑥ 通用视频课（不绑 PET） ----------
     三张表：
       edu_course           课程（科目 + 年级 + 课程名）
       edu_video            视频/课（序号 + 课名 + 类型 + 原始文件名 + 播放地址）
       edu_video_progress   每人每视频的最新进度（累计观看秒数用来判断 5 分钟门槛）
     没有历史表：产品口径是「只要最新进度」。 */
  if (await tableExists("edu_course")) {
    skip("表 edu_course 已存在");
  } else {
    plan("建表 edu_course（科目 / 年级 / 课程名）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `edu_course` (" +
          "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
          "`subject` VARCHAR(32) NOT NULL COMMENT '科目，如 数学'," +
          "`grade` VARCHAR(32) NOT NULL COMMENT '年级，如 六年级'," +
          "`name` VARCHAR(128) NOT NULL COMMENT '课程名，如 2025秋下 六年级数学A+ 洪然'," +
          "`status` TINYINT NOT NULL DEFAULT 1 COMMENT '1 上架 / 0 下架'," +
          "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
          "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`id`)," +
          "UNIQUE KEY `uk_edu_course` (`subject`, `grade`, `name`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用视频课 · 课程'");
      log("建表 edu_course");
      changed++;
    }
  }

  if (await tableExists("edu_video")) {
    skip("表 edu_video 已存在");
  } else {
    plan("建表 edu_video（序号 / 课名 / 类型 / 文件名 / 播放地址）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `edu_video` (" +
          "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
          "`course_id` BIGINT UNSIGNED NOT NULL COMMENT 'edu_course.id'," +
          "`seq` SMALLINT UNSIGNED NOT NULL COMMENT '文件名序号 1、2、3…'," +
          "`lesson_name` VARCHAR(128) NOT NULL COMMENT '课名，如 圆的认识与周长'," +
          "`lesson_type` VARCHAR(16) NOT NULL DEFAULT '' COMMENT '正课 / 真题练 等'," +
          "`file_name` VARCHAR(255) NOT NULL COMMENT '原始文件名（含扩展名，原样保存）'," +
          "`file_url` VARCHAR(512) NOT NULL COMMENT '实际播放地址（相对路径或完整 URL）'," +
          "`duration_sec` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '视频总时长（首次播放后回填）'," +
          "`status` TINYINT NOT NULL DEFAULT 1 COMMENT '1 上架 / 0 下架'," +
          "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
          "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`id`)," +
          "UNIQUE KEY `uk_edu_video` (`course_id`, `seq`)," +
          "KEY `idx_edu_video_course` (`course_id`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用视频课 · 视频/课'");
      log("建表 edu_video");
      changed++;
    }
  }

  if (await tableExists("edu_video_progress")) {
    skip("表 edu_video_progress 已存在");
  } else {
    plan("建表 edu_video_progress（user_id + video_id 唯一，只留最新进度）");
    if (!DRY) {
      await pool.query(
        "CREATE TABLE `edu_video_progress` (" +
          "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
          "`user_id` BIGINT UNSIGNED NOT NULL COMMENT 'user.id'," +
          "`video_id` BIGINT UNSIGNED NOT NULL COMMENT 'edu_video.id'," +
          "`position_sec` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上次自然播放位置（秒）'," +
          "`duration_sec` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上次已知视频总时长（秒）'," +
          "`watched_sec` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计有效观看秒数（墙钟）'," +
          "`completed` TINYINT NOT NULL DEFAULT 0 COMMENT '是否看完 0/1'," +
          "`last_played_at` DATETIME NULL COMMENT '最近一次播放时间'," +
          "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP," +
          "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP," +
          "PRIMARY KEY (`id`)," +
          "UNIQUE KEY `uk_edu_video_progress` (`user_id`, `video_id`)," +
          "KEY `idx_edu_video_progress_user` (`user_id`, `updated_at`)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用视频课 · 每人每视频最新进度'");
      log("建表 edu_video_progress");
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
