/* PET 精读后端 · 数据访问层
   ================================================================
   收藏要用到的 SQL 全部集中在这里（唯一一处碰数据库的地方）。

   涉及的表：
     user           用户（按 phone 查/建；migrate 加了 nickname / pass_hash / user_level 三列）
     pet_user_level 等级颜色表（18 行，1=蓝 … 18=金；migrate 建表并写值）
     pet_mistake    错题记录（user_id + slug + 题号 唯一，重复错就计数）
     pet_word       全站单词表（uk_word 唯一）
     pet_sentence   全站句子表（uk_hash 唯一，hash = sha256(句子)）
     user_word      用户-单词关联（uk: user_id + level + word_id）
     user_sentence  用户-句子关联（uk: user_id + level + sentence_id）
     pet_phrase     词组库内容镜像（uk_phrase_text 唯一；真源 data/phrases.json）
     user_phrase    用户-词组关联（uk: user_id + level + phrase_id；带内容快照）
     pet_phrase_mistake 词组选择题错题（uk: user_id + phrase_id，重复错就计数）

   设计约定：
   · 收藏 = 建关联。pet_word / pet_sentence 里没有就补一条（只填我们知道的字段，
     其余留空、status 走默认 0 等后续流程补全），有就直接复用。
     取消收藏只删关联行，公共词句库永远不动。
   · 哈希在服务端算：页面跑在 http:// 下（非安全上下文），浏览器拿不到
     crypto.subtle，客户端本来就无法算 SHA-256，也不该算。
   · level / source_type 从配置进来（level 默认 "PET"；source_type 默认 2=文章）。
   · LAST_INSERT_ID(id) 这把戏让「新插入」和「已存在」两条路都从 insertId 拿到 id，
     省掉「先查再插」的来回。
*/

import mysql from "mysql2/promise";
import { sha256Hex, fitText, levelColor } from "./lib.mjs";

export function createPool(cfg) {
  return mysql.createPool({
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    connectTimeout: 10000
  });
}

export function createDb(pool, opts) {
  opts = opts || {};
  const LEVEL = opts.level || "PET";
  const SOURCE_TYPE = opts.sourceType == null ? 2 : opts.sourceType; // 2=文章
  const TITLE_MAX = 255;

  async function ping() {
    await pool.query("SELECT 1");
  }

  /* 按手机号拿 user.id；没有就建一个。 */
  async function ensureUser(phone) {
    const [r] = await pool.query(
      "INSERT INTO `user` (`phone`) VALUES (?) ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`)",
      [phone]
    );
    return r.insertId;
  }

  /* 登录 / 注册用：拿整行（含昵称、密码散列、等级）。
     昵称/密码/等级三列由 migrate.mjs 加上（没跑迁移时这里的 SQL 会报错，
     那是部署事故，应该炸出来而不是静默降级）。 */
  async function getUserByPhone(phone) {
    const [rows] = await pool.query(
      "SELECT `id`, `phone`, `nickname`, `pass_hash`, `user_level` " +
        "FROM `user` WHERE `phone` = ? LIMIT 1",
      [phone]
    );
    return rows.length ? rows[0] : null;
  }

  /* 等级 → 颜色：先查 pet_user_level 表（migrate 写的 18 行），查不到走兜底色。
     表本身缺了不拦路 —— 颜色只影响观感，不该把登录搞挂。 */
  async function getLevelColor(level) {
    const n = parseInt(level, 10) || 1;
    try {
      const [rows] = await pool.query(
        "SELECT `color` FROM `pet_user_level` WHERE `level` = ? LIMIT 1", [n]);
      if (rows.length && rows[0].color) return rows[0].color;
    } catch (e) { /* 表还没建：用兜底色 */ }
    return levelColor(n);
  }

  /* 用户对外形状（登录/注册/me 三个接口共用，别在路由里各拼一遍） */
  async function userShape(row) {
    return {
      phone: row.phone,
      nickname: row.nickname || "",
      level: parseInt(row.user_level, 10) || 1,
      color: await getLevelColor(row.user_level)
    };
  }

  /* 注册。两条路都算成功：
       ① 手机号没进过库 → 建号（等级从 1 起）
       ② 进过库但还没设密码（老的软登录留下的行）→ 补上昵称和密码
     已经设过密码的号返回 {exists:true}，由服务层转成 400「已注册」。
     用事务 + FOR UPDATE 防同号并发注册打出两条路各走一半。 */
  async function registerUser(data) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        "SELECT `id`, `pass_hash` FROM `user` WHERE `phone` = ? FOR UPDATE",
        [data.phone]
      );
      let userId, completed = false;
      if (!rows.length) {
        const [r] = await conn.query(
          "INSERT INTO `user` (`phone`, `nickname`, `pass_hash`, `user_level`) VALUES (?, ?, ?, 1)",
          [data.phone, data.nickname, data.passHash]
        );
        userId = r.insertId;
      } else if (!rows[0].pass_hash) {
        await conn.query(
          "UPDATE `user` SET `nickname` = ?, `pass_hash` = ? WHERE `id` = ?",
          [data.nickname, data.passHash, rows[0].id]
        );
        userId = rows[0].id;
        completed = true;
      } else {
        await conn.rollback();
        return { exists: true };
      }
      await conn.commit();
      return { userId: userId, completed: completed };
    } catch (e) {
      try { await conn.rollback(); } catch (e2) { /* 回滚失败也没别的办法 */ }
      throw e;
    } finally {
      conn.release();
    }
  }

  /* ---------- 错题记录 ----------
     一道题一个用户只留一行：第一次错插入，再错就换最新选的那个并计数 +1。 */
  async function addMistake(data) {
    const userId = await ensureUser(data.phone);
    await pool.query(
      "INSERT INTO `pet_mistake` (`user_id`, `slug`, `q_n`, `chosen`, `correct`) VALUES (?, ?, ?, ?, ?) " +
        "ON DUPLICATE KEY UPDATE `chosen` = ?, `correct` = ?, " +
        "`wrong_count` = `wrong_count` + 1, `updated_at` = CURRENT_TIMESTAMP",
      [userId, data.slug, data.qN, data.chosen, data.correct, data.chosen, data.correct]
    );
    return { ok: true };
  }

  async function listMistakes(phone) {
    const userId = await getUserId(phone);
    if (!userId) return { items: [] };
    const [rows] = await pool.query(
      "SELECT `slug`, `q_n` AS q, `chosen`, `correct`, `wrong_count` AS cnt, " +
        "UNIX_TIMESTAMP(`updated_at`) * 1000 AS ts " +
        "FROM `pet_mistake` WHERE `user_id` = ? ORDER BY `updated_at` DESC, `id` DESC",
      [userId]
    );
    return {
      items: rows.map(function (r0) {
        return {
          slug: r0.slug,
          q: Number(r0.q) || 0,
          chosen: r0.chosen,
          correct: r0.correct,
          count: Number(r0.cnt) || 1,
          ts: Number(r0.ts) || 0
        };
      })
    };
  }

  async function getUserId(phone) {
    const [rows] = await pool.query("SELECT `id` FROM `user` WHERE `phone` = ? LIMIT 1", [phone]);
    return rows.length ? rows[0].id : null;
  }

  /* 收藏单词：pet_word 没有就插（把内容里现有的字段一次带全），然后挂用户关联。
     重复收藏不重复建行，也不覆盖已有字段（先到先得，补全交给后续流程）。 */
  async function addWordFav(data) {
    const userId = await ensureUser(data.phone);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      /* 例句：有就顺带保证它在句子表里（与收藏句子同一套 sha256 去重），
         再把 hash 写进 pet_word.sentence_hash —— 「去重/关联」从第一天就成立。
         已有同 hash 的句子时什么都不改（不同来源的翻译/分析不互相覆盖）。 */
      let sentenceHash = null;
      if (data.example) {
        sentenceHash = sha256Hex(data.example);
        await conn.query(
          "INSERT INTO `pet_sentence` (`hash`, `sentence`, `sentence_translation`, `analysis`) " +
            "VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `id` = `id`",
          [
            sentenceHash,
            data.example,
            data.exampleTranslation ? data.exampleTranslation : null,
            data.exampleAnalysis ? data.exampleAnalysis : null
          ]
        );
      }

      const [w] = await conn.query(
        "INSERT INTO `pet_word` " +
          "(`word`, `meaning`, `phonetic`, `pos`, `mnemonic`, `example`, `phrase`, `sentence_hash`) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`)",
        [
          data.word,
          data.meaning ? data.meaning : null,
          data.phonetic ? data.phonetic : null,
          data.pos ? data.pos : null,
          data.mnemonic ? data.mnemonic : null,
          data.example ? data.example : null,
          data.phrase ? data.phrase : null,
          sentenceHash
        ]
      );
      const wordId = w.insertId;
      await conn.query(
        "INSERT INTO `user_word` (`user_id`, `level`, `word_id`, `source_type`, `source_title`) " +
          "VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `id` = `id`",
        [userId, LEVEL, wordId, SOURCE_TYPE, fitText(data.sourceTitle || "", TITLE_MAX) || null]
      );
      await conn.commit();
      return { wordId: wordId, userId: userId };
    } catch (e) {
      try { await conn.rollback(); } catch (e2) { /* 回滚失败也没别的办法 */ }
      throw e;
    } finally {
      conn.release();
    }
  }

  /* 取消收藏单词：只删 user_word 那一行（词库里留着） */
  async function removeWordFav(data) {
    const userId = await getUserId(data.phone);
    if (!userId) return { removed: 0 };
    const [r] = await pool.query(
      "DELETE uw FROM `user_word` uw JOIN `pet_word` w ON w.`id` = uw.`word_id` " +
        "WHERE uw.`user_id` = ? AND uw.`level` = ? AND w.`word` = ?",
      [userId, LEVEL, data.word]
    );
    return { removed: r.affectedRows };
  }

  /* 收藏句子：hash = sha256(trim 后的句子)，pet_sentence 里没有就插，然后挂用户关联 */
  async function addSentenceFav(data) {
    const hash = sha256Hex(data.sentence);
    const userId = await ensureUser(data.phone);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [s] = await conn.query(
        "INSERT INTO `pet_sentence` (`hash`, `sentence`, `sentence_translation`, `analysis`) " +
          "VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`)",
        [
          hash,
          data.sentence,
          data.translation ? data.translation : null,
          data.analysis ? data.analysis : null
        ]
      );
      const sentenceId = s.insertId;
      await conn.query(
        "INSERT INTO `user_sentence` (`user_id`, `level`, `sentence_id`, `source_type`, `source_title`) " +
          "VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `id` = `id`",
        [userId, LEVEL, sentenceId, SOURCE_TYPE, fitText(data.sourceTitle || "", TITLE_MAX) || null]
      );
      await conn.commit();
      return { sentenceId: sentenceId, userId: userId, hash: hash };
    } catch (e) {
      try { await conn.rollback(); } catch (e2) { /* 同上 */ }
      throw e;
    } finally {
      conn.release();
    }
  }

  async function removeSentenceFav(data) {
    const userId = await getUserId(data.phone);
    if (!userId) return { removed: 0 };
    const hash = sha256Hex(data.sentence);
    const [r] = await pool.query(
      "DELETE us FROM `user_sentence` us JOIN `pet_sentence` s ON s.`id` = us.`sentence_id` " +
        "WHERE us.`user_id` = ? AND us.`level` = ? AND s.`hash` = ?",
      [userId, LEVEL, hash]
    );
    return { removed: r.affectedRows };
  }

  /* analysis 列存的是 JSON 字符串（句子分析对象）—— 给客户端的形状里是对象 */
  function parseAna(s) {
    if (!s) return null;
    try {
      const o = JSON.parse(s);
      return o && typeof o === "object" ? o : null;
    } catch (e) { return null; }
  }

  /* ---------- 词组收藏 ----------
     和单词/句子同一套路：pet_phrase 里没有就补一条（内容以页面传上来的为准，
     文件真源是 data/phrases.json），然后挂用户关联。
     user_phrase 里**存一份内容快照**（词组/中文/例句/例句翻译）——
     词书和复习页读它就不用 join，内容改了老收藏也不烂。 */
  async function ensurePhrase(conn, data) {
    const [p] = await conn.query(
      "INSERT INTO `pet_phrase` " +
        "(`no`, `grp`, `phrase`, `alt`, `meaning`, `usage_note`, `example`, `example_cn`, `blank`, `quest`, `status`) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) " +
        "ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`)",
      [
        data.no || 0,
        Math.max(1, Math.ceil((data.no || 1) / 10)),
        data.phrase,
        fitChars(data.alt || "", 128),
        fitText(data.meaning || ""),
        fitText(data.usageNote || ""),
        fitText(data.example || ""),
        fitText(data.exampleCn || ""),
        fitChars(data.blank || "", 128),
        data.why ? JSON.stringify({ why: data.why, trap: data.trap || "" }) : null
      ]
    );
    return p.insertId;
  }

  async function addPhraseFav(data) {
    const userId = await ensureUser(data.phone);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const phraseId = await ensurePhrase(conn, data);
      await conn.query(
        "INSERT INTO `user_phrase` " +
          "(`user_id`, `phrase_id`, `level`, `phrase`, `meaning`, `example`, `example_cn`, `source_type`, `source_title`) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON DUPLICATE KEY UPDATE `id` = `id`",
        [
          userId, phraseId, LEVEL, data.phrase, fitText(data.meaning || ""),
          fitText(data.example || ""), fitText(data.exampleCn || ""),
          SOURCE_TYPE === 2 ? 3 : SOURCE_TYPE, fitText(data.sourceTitle || "", TITLE_MAX) || null
        ]
      );
      await conn.commit();
      return { phraseId: phraseId, userId: userId };
    } catch (e) {
      try { await conn.rollback(); } catch (e2) { /* 同上 */ }
      throw e;
    } finally {
      conn.release();
    }
  }

  /* 取消收藏词组：只删 user_phrase 那一行（pet_phrase 留着） */
  async function removePhraseFav(data) {
    const userId = await getUserId(data.phone);
    if (!userId) return { removed: 0 };
    const [r] = await pool.query(
      "DELETE up FROM `user_phrase` up JOIN `pet_phrase` p ON p.`id` = up.`phrase_id` " +
        "WHERE up.`user_id` = ? AND up.`level` = ? AND p.`phrase` = ?",
      [userId, LEVEL, data.phrase]
    );
    return { removed: r.affectedRows };
  }

  /* ---------- 词组错题 ----------
     一道题一个用户只留一行：第一次错插入，再错就换最新选的那个并计数 +1。 */
  async function addPhraseMistake(data) {
    const userId = await ensureUser(data.phone);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const phraseId = await ensurePhrase(conn, data);
      await conn.query(
        "INSERT INTO `pet_phrase_mistake` " +
          "(`user_id`, `phrase_id`, `phrase_no`, `phrase`, `stem`, `chosen`, `chosen_k`, `correct`, `correct_k`) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON DUPLICATE KEY UPDATE `chosen` = ?, `chosen_k` = ?, `correct` = ?, `correct_k` = ?, " +
          "`stem` = ?, `wrong_count` = `wrong_count` + 1, `updated_at` = CURRENT_TIMESTAMP",
        [
          userId, phraseId, data.no || 0, data.phrase, fitText(data.stem || ""),
          fitChars(data.chosen || "", 128), data.chosenK || "",
          fitChars(data.correct || "", 128), data.correctK || "",
          fitChars(data.chosen || "", 128), data.chosenK || "",
          fitChars(data.correct || "", 128), data.correctK || "",
          fitText(data.stem || "")
        ]
      );
      await conn.commit();
      return { ok: true };
    } catch (e) {
      try { await conn.rollback(); } catch (e2) { /* 同上 */ }
      throw e;
    } finally {
      conn.release();
    }
  }

  async function listPhraseMistakes(phone) {
    const userId = await getUserId(phone);
    if (!userId) return { items: [] };
    const [rows] = await pool.query(
      "SELECT `phrase_no` AS no, `phrase`, `stem`, `chosen`, `correct`, " +
        "`wrong_count` AS cnt, UNIX_TIMESTAMP(`updated_at`) * 1000 AS ts " +
        "FROM `pet_phrase_mistake` WHERE `user_id` = ? ORDER BY `updated_at` DESC, `id` DESC",
      [userId]
    );
    return {
      items: rows.map(function (r0) {
        return {
          no: Number(r0.no) || 0,
          phrase: r0.phrase,
          stem: r0.stem,
          chosen: r0.chosen,
          correct: r0.correct,
          count: Number(r0.cnt) || 1,
          ts: Number(r0.ts) || 0
        };
      })
    };
  }

  /* ---------- 词组复习（间隔重复） ----------
     一个用户一条词组只留一行：答对升级（间隔变长）、答错回到 1 级（明天再来）。
     到期日由服务端算（srsNext），这里只负责把 level / due_at 落库。 */
  async function addPhraseReview(data) {
    const userId = await ensureUser(data.phone);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const phraseId = await ensurePhrase(conn, data);
      await conn.query(
        "INSERT INTO `pet_phrase_review` " +
          "(`user_id`, `phrase_id`, `phrase_no`, `phrase`, `level`, `reps`, `wrongs`, `due_at`) " +
          "VALUES (?, ?, ?, ?, ?, 1, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY)) " +
          "ON DUPLICATE KEY UPDATE `level` = VALUES(`level`), `phrase_no` = VALUES(`phrase_no`), " +
          "`phrase` = VALUES(`phrase`), `reps` = `reps` + 1, " +
          "`wrongs` = `wrongs` + VALUES(`wrongs`), `due_at` = VALUES(`due_at`), " +
          "`updated_at` = CURRENT_TIMESTAMP",
        [
          userId, phraseId, data.no || 0, data.phrase,
          Math.max(1, Math.min(6, parseInt(data.level, 10) || 1)),
          data.ok ? 0 : 1,
          Math.max(0, Math.min(60, parseInt(data.days, 10) || 1))
        ]
      );
      await conn.commit();
      return { ok: true };
    } catch (e) {
      try { await conn.rollback(); } catch (e2) { /* 同上 */ }
      throw e;
    } finally {
      conn.release();
    }
  }

  /* 复习列表：due=1 只要到期的（默认），due=0 全部（前端自己算「没练过的」） */
  async function listPhraseReviews(phone, opts) {
    const userId = await getUserId(phone);
    if (!userId) return { items: [] };
    const dueOnly = !(opts && opts.all);
    const limit = Math.max(1, Math.min(200, (opts && opts.limit) || 100));
    const [rows] = await pool.query(
      "SELECT r.`phrase_no` AS no, r.`phrase` AS phrase, r.`level` AS level, " +
        "r.`reps` AS reps, r.`wrongs` AS wrongs, DATE_FORMAT(r.`due_at`, '%Y-%m-%d') AS due, " +
        "p.`meaning` AS meaning, p.`example` AS example, p.`example_cn` AS exampleCn, p.`usage_note` AS useNote " +
        "FROM `pet_phrase_review` r LEFT JOIN `pet_phrase` p ON p.`id` = r.`phrase_id` " +
        "WHERE r.`user_id` = ?" + (dueOnly ? " AND r.`due_at` <= CURDATE()" : "") +
        " ORDER BY r.`due_at` ASC, r.`id` ASC LIMIT ?",
      [userId, limit]
    );
    return {
      items: rows.map(function (r0) {
        return {
          no: Number(r0.no) || 0,
          phrase: r0.phrase,
          level: Number(r0.level) || 1,
          reps: Number(r0.reps) || 0,
          wrongs: Number(r0.wrongs) || 0,
          due: r0.due || "",
          meaning: r0.meaning || "",
          example: r0.example || "",
          exampleCn: r0.exampleCn || "",
          use: r0.useNote || ""
        };
      })
    };
  }

  /* 某个用户的全部收藏（客户端把它并进本地收藏表：词书页、点亮星星、跨设备恢复）。
     形状与本地条目一致：单词带 音标/词性/例句(连翻译)/搭配，句子带分析 ——
     词书详情页直接拿这份数据渲染，不用再单独请求。
     排序：单词按**词表 pet_word.created_at**（收录时间，最新在前）；
     句子按收藏时间（user_sentence.created_at，最新在前）。 */
  async function listFavs(phone) {
    const userId = await getUserId(phone);
    if (!userId) return { items: [] };

    const [words] = await pool.query(
      "SELECT w.`word` AS word, w.`meaning` AS meaning, w.`phonetic` AS phonetic, w.`pos` AS pos, " +
        "w.`example` AS example, w.`phrase` AS phrase, ps.`sentence_translation` AS exampleTr, " +
        "UNIX_TIMESTAMP(uw.`created_at`) * 1000 AS ts " +
        "FROM `user_word` uw " +
        "JOIN `pet_word` w ON w.`id` = uw.`word_id` " +
        "LEFT JOIN `pet_sentence` ps ON ps.`hash` = w.`sentence_hash` " +
        "WHERE uw.`user_id` = ? AND uw.`level` = ? " +
        "ORDER BY w.`created_at` DESC, w.`id` DESC",
      [userId, LEVEL]
    );
    const [sents] = await pool.query(
      "SELECT s.`sentence` AS sentence, s.`sentence_translation` AS translation, s.`analysis` AS analysis, " +
        "us.`source_title` AS sourceTitle, UNIX_TIMESTAMP(us.`created_at`) * 1000 AS ts " +
        "FROM `user_sentence` us JOIN `pet_sentence` s ON s.`id` = us.`sentence_id` " +
        "WHERE us.`user_id` = ? AND us.`level` = ? " +
        "ORDER BY us.`created_at` DESC, us.`id` DESC",
      [userId, LEVEL]
    );
    /* 词组：读的是 user_phrase 里的快照（内容改了老收藏也不烂），
       组号/用法从 pet_phrase 顺带带出来（老数据 join 不到也有默认值） */
    const [phrases] = await pool.query(
      "SELECT up.`phrase` AS phrase, up.`meaning` AS meaning, up.`example` AS example, " +
        "up.`example_cn` AS exampleCn, p.`no` AS no, p.`usage_note` AS useNote, " +
        "UNIX_TIMESTAMP(up.`created_at`) * 1000 AS ts " +
        "FROM `user_phrase` up LEFT JOIN `pet_phrase` p ON p.`id` = up.`phrase_id` " +
        "WHERE up.`user_id` = ? AND up.`level` = ? " +
        "ORDER BY up.`created_at` DESC, up.`id` DESC",
      [userId, LEVEL]
    );

    const items = [];
    words.forEach(function (r) {
      items.push({
        type: "w",
        key: r.word,
        cn: r.meaning || "",
        pos: r.pos || "",
        ipa: r.phonetic || "",
        ex: r.example || "",
        exTr: r.exampleTr || "",
        ph: r.phrase || "",
        ts: Number(r.ts) || 0
      });
    });
    sents.forEach(function (r) {
      items.push({
        type: "s",
        key: r.sentence,
        cn: r.translation || "",
        ana: parseAna(r.analysis),
        title: r.sourceTitle || "",
        ts: Number(r.ts) || 0
      });
    });
    phrases.forEach(function (r) {
      items.push({
        type: "p",
        key: r.phrase,
        cn: r.meaning || "",
        use: r.useNote || "",
        ex: r.example || "",
        exTr: r.exampleCn || "",
        no: Number(r.no) || 0,
        ts: Number(r.ts) || 0
      });
    });
    return { items: items };
  }

  return {
    ping: ping,
    ensureUser: ensureUser,
    getUserId: getUserId,
    getUserByPhone: getUserByPhone,
    getLevelColor: getLevelColor,
    userShape: userShape,
    registerUser: registerUser,
    addWordFav: addWordFav,
    removeWordFav: removeWordFav,
    addSentenceFav: addSentenceFav,
    removeSentenceFav: removeSentenceFav,
    addPhraseFav: addPhraseFav,
    removePhraseFav: removePhraseFav,
    addPhraseMistake: addPhraseMistake,
    listPhraseMistakes: listPhraseMistakes,
    addPhraseReview: addPhraseReview,
    listPhraseReviews: listPhraseReviews,
    listFavs: listFavs,
    addMistake: addMistake,
    listMistakes: listMistakes
  };
}
