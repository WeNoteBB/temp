/* PET 精读后端 · 真库自检
   ================================================================
   在能连上 MySQL 的机器上跑（部署后的 ECS 最合适）：

       cd /opt/pet-api
       node --env-file=.env selftest.mjs [手机号]

   全流程走一遍：等级颜色表 → 注册 → 密码校验 → 错题记录 →
                建用户 → 收藏单词 → 收藏句子 → 列表能看到 → 取消 → 列表消失。
    注册那步用一个随机 139 号，跑完连人带错题一起清掉。
   用一个测试手机号（默认 13800000000）和带时间戳的测试词句，不会撞真实数据。
   结束时测试用户行保留（方便你自己去库里看一眼），测试词句行和关联行都会清掉；
   测试 token 全带时间戳/zz-selftest 前缀，收尾只删这些。
*/

import { configFromEnv } from "./server.mjs";
import { createPool, createDb } from "./db.mjs";
import { sha256Hex, hashPassword, verifyPassword, LEVEL_COLORS } from "./lib.mjs";

const phone = process.argv[2] || "13800000000";
const cfg = configFromEnv();
const pool = createPool(cfg.db);
const db = createDb(pool, { level: cfg.level, sourceType: cfg.sourceType });

let nFail = 0;
const mark = (cond, msg) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) nFail++;
};

const stamp = Date.now().toString(36);
const word = "zz-selftest-" + stamp;
const sentence = "This is a PET selftest sentence (" + stamp + ").";
const example = "This is a PET selftest example sentence (" + stamp + ").";

try {
  console.log("连接 " + cfg.db.user + "@" + cfg.db.host + ":" + cfg.db.port + "/" + cfg.db.database + " …");
  await db.ping();
  console.log("数据库连通 ✓\n");

  const userId = await db.ensureUser(phone);
  mark(!!userId, "确保测试用户存在（user.id = " + userId + "，手机号 " + phone + "）");

  /* ---- 等级颜色表（migrate.mjs 负责建表写值） ---- */
  const [lvRows] = await pool.query("SELECT `level`, `color` FROM `pet_user_level` ORDER BY `level`");
  mark(lvRows.length === 18 && lvRows[0].color === LEVEL_COLORS[0] && lvRows[17].color === LEVEL_COLORS[17],
    "pet_user_level：18 行，首尾颜色对得上（1=蓝 " + LEVEL_COLORS[0] + " / 18=金 " + LEVEL_COLORS[17] + "）");

  /* ---- 注册 / 登录 / me（用一个随机测试号，不碰固定号，跑多少次都干净） ---- */
  const regPhone = "139" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const pw = "selftest-" + stamp;
  const reg = await db.registerUser({ phone: regPhone, nickname: "自检用户", passHash: hashPassword(pw) });
  mark(!reg.exists && !!reg.userId, "注册新用户（" + regPhone + "，user.id = " + reg.userId + "）");
  const row = await db.getUserByPhone(regPhone);
  mark(!!row && row.nickname === "自检用户" &&
       verifyPassword(pw, row.pass_hash) && !verifyPassword("wrong-pw", row.pass_hash),
    "user 行：昵称在、密码能验证、错误密码验不过");
  const shape = await db.userShape(row);
  mark(shape.level === 1 && shape.color === LEVEL_COLORS[0],
    "userShape：新号 1 级 + 蓝色（" + shape.color + "）");
  const reg2 = await db.registerUser({ phone: regPhone, nickname: "再注册", passHash: hashPassword("another-pw") });
  mark(reg2.exists === true, "同号再注册 → exists（服务层转成 400「已注册」）");

  /* ---- 错题记录 ---- */
  const tSlug = "t1-p4-digging-into-the-past";
  await db.addMistake({ phone: regPhone, slug: tSlug, qN: 16, chosen: "B", correct: "C" });
  await db.addMistake({ phone: regPhone, slug: tSlug, qN: 16, chosen: "A", correct: "C" });
  const ms = await db.listMistakes(regPhone);
  const m0 = ms.items.filter(x => x.slug === tSlug && x.q === 16)[0];
  mark(!!m0 && m0.chosen === "A" && m0.correct === "C" && m0.count === 2,
    "错题：同题错两次只留一行，chosen 换成最新的、计数 2");

  await db.addWordFav({
    phone, word, meaning: "自检单词",
    phonetic: "/ˌselfˈtest/", pos: "n.",
    example,
    exampleTranslation: "自检例句",
    exampleAnalysis: JSON.stringify({ pat: ["主系表"] }),
    phrase: "run a selftest",
    sourceTitle: "selftest"
  });
  mark(true, "收藏单词（带音标/词性/例句/搭配）：" + word);

  const h = await db.addSentenceFav({
    phone, sentence,
    translation: "自检句子",
    analysis: JSON.stringify({ pat: ["selftest"] }),
    sourceTitle: "selftest"
  });
  mark(!!h.hash && h.hash.length === 64, "收藏句子并算出 hash：" + h.hash.slice(0, 12) + "…");

  let list = await db.listFavs(phone);
  mark(list.items.some(x => x.type === "w" && x.key === word), "列表里能看到刚收藏的单词");
  mark(list.items.some(x => x.type === "s" && x.key === sentence), "列表里能看到刚收藏的句子");

  /* 重复收藏同一条：应该不报错、也不新增行 */
  await db.addWordFav({ phone, word, meaning: "自检单词", sourceTitle: "selftest" });
  await db.addSentenceFav({ phone, sentence, translation: "自检句子", analysis: "", sourceTitle: "selftest" });
  const dup = await db.listFavs(phone);
  const wCount = dup.items.filter(x => x.type === "w" && x.key === word).length;
  const sCount = dup.items.filter(x => x.type === "s" && x.key === sentence).length;
  mark(wCount === 1 && sCount === 1, "重复收藏不产生重复关联（唯一键生效）");

  /* 单词表：字段是不是都落进去了（放在重复收藏之后查，顺带证明不覆盖已有字段） */
  const [wr] = await pool.query(
    "SELECT phonetic, pos, example, phrase, sentence_hash FROM pet_word WHERE word = ?", [word]);
  mark(wr.length === 1 && wr[0].phonetic === "/ˌselfˈtest/" && wr[0].pos === "n." && wr[0].phrase === "run a selftest",
    "pet_word：音标/词性/搭配都在，重复收藏不覆盖");
  mark(wr[0].example === example && wr[0].sentence_hash === sha256Hex(example),
    "pet_word：例句 + sentence_hash = sha256(例句)");

  /* 例句也进了句子表（同一套 hash 去重），翻译一起在 */
  const [sr] = await pool.query(
    "SELECT sentence, sentence_translation FROM pet_sentence WHERE hash = ?", [sha256Hex(example)]);
  mark(sr.length === 1 && sr[0].sentence === example && sr[0].sentence_translation === "自检例句",
    "pet_sentence：例句关联成立（hash 命中，翻译在）");

  /* listFavs 的返回（词书详情页的数据源）：字段也要带全 */
  const listed = await db.listFavs(phone);
  const lw = listed.items.find(x => x.type === "w" && x.key === word);
  const ls = listed.items.find(x => x.type === "s" && x.key === sentence);
  mark(lw && lw.ipa === "/ˌselfˈtest/" && lw.pos === "n." && lw.ex === example &&
    lw.exTr === "自检例句" && lw.ph === "run a selftest",
    "listFavs：单词带 音标/词性/例句(连翻译)/搭配");
  mark(ls && ls.cn === "自检句子" && ls.ana && ls.ana.pat[0] === "selftest",
    "listFavs：句子带 翻译 + 分析对象");

  await db.removeWordFav({ phone, word });
  await db.removeSentenceFav({ phone, sentence });
  list = await db.listFavs(phone);
  mark(!list.items.some(x => x.key === word), "取消后单词从列表消失");
  mark(!list.items.some(x => x.key === sentence), "取消后句子从列表消失");

  /* 收尾：把测试词句两行也删掉（关联行上面已经删了）。
     只有这里直接碰 pool —— 它是测试收尾，不属于业务 SQL（业务 SQL 全在 db.mjs）。 */
  await pool.query("DELETE FROM `pet_word` WHERE `word` = ?", [word]);
  await pool.query("DELETE FROM `pet_sentence` WHERE `hash` IN (?, ?)", [sha256Hex(sentence), sha256Hex(example)]);
  /* 注册用的随机测试号连人带错题一起清掉 */
  await pool.query("DELETE FROM `pet_mistake` WHERE `user_id` = ?", [reg.userId]);
  await pool.query("DELETE FROM `user` WHERE `phone` = ?", [regPhone]);
  await pool.end();
  console.log("  · 已清理测试词句行、随机测试用户和它的错题行（固定测试号那行用户保留）");

  console.log(nFail ? "\n✗ 有 " + nFail + " 项没过，看上面的 ✗" : "\n✓ 全部通过 —— 后端到数据库这条链路是通的");
  process.exit(nFail ? 1 : 0);
} catch (e) {
  console.error("\n✗ 自检中断：" + ((e && e.message) || e));
  const msg = String((e && e.message) || "");
  if (/Access denied/i.test(msg)) {
    console.error("  → 数据库拒绝了这个来源 IP。请在 MySQL 里给 `" + cfg.db.user +
      "` 这个账号授权这台服务器的 IP（或 '%'），并确认密码。");
  }
  if (!cfg.db.password || cfg.db.password === "在这里填密码") {
    console.error("  → DB_PASS 还没配置。把 server/.env.example 复制成 .env 填好再用 `node --env-file=.env selftest.mjs` 跑。");
  }
  if (/ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
    console.error("  → 连不到 MySQL（" + cfg.db.host + ":" + cfg.db.port + "）：检查 DB_HOST/DB_PORT、或数据库有没有对这台机器开放。");
  }
  process.exit(1);
}
