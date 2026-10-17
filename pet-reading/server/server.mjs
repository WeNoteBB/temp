/* PET 精读后端 · HTTP 入口
   ================================================================
   接口（全部 JSON；成功一律 {ok:true,...}，失败 {ok:false,err}）：

     POST /api/register     {phone, nickname, password}
        → {ok, user:{phone, nickname, level, color}}
        · 手机号没进过库 → 建号（等级 1）
        · 进过库但没设过密码（老的软登录用户）→ 补上昵称和密码，也算注册
        · 已经设过密码 → 400「已注册」
     POST /api/login        {phone, password}
        → {ok, user:{...}}                校验密码（scrypt）
     GET  /api/me?phone=138…
        → {ok, user:{...}} | {ok, user:null}（没这个号不算错，前端好判）
     GET  /api/favs?phone=138…
        → {ok, items:[{type,key,cn,title?,ts}]}   客户端的收藏形状
     POST /api/favs/add     {phone, kind:"word",     word, meaning, sourceTitle?}
        → {ok, wordId}
     POST /api/favs/add     {phone, kind:"sentence", sentence, translation, analysis, sourceTitle?}
        → {ok, sentenceId, hash}
     POST /api/favs/remove  {phone, kind:"word",     word}
                       或   {phone, kind:"sentence", sentence}
        → {ok, removed}
     POST /api/mistakes     {phone, slug, q, chosen, correct}
        → {ok}                            错题登记（同题重复错只计数 +1）
     GET  /api/mistakes?phone=138…
        → {ok, items:[{slug, q, chosen, correct, count, ts}]}
     GET  /api/health       → {ok, db:"up"}

   ⚠ 认证口径：除了注册/登录校验密码，其余接口仍按手机号认人（软认证）。
     这是本项目的刻意取舍（学生工具、内容不敏感），不是忘了做 token。

   本地联调：dist/ 存在时顺手把静态站点也挂上（生产由 nginx 伺服 dist，用不到这段）。
   真库自检： node --env-file=.env selftest.mjs
   建表/加列： node --env-file=.env migrate.mjs
*/

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validPhone, normPhone, normWord, normSentence,
  normNickname, validNickname, validPassword, verifyPassword, hashPassword,
  SLUG_RE,
  WORD_MAX, TEXT_MAX_BYTES, TITLE_MAX, fitText, fitChars, byteLen
} from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function configFromEnv(env) {
  env = env || process.env;
  return {
    port: parseInt(env.PORT || "3001", 10),
    host: env.HOST || "127.0.0.1",
    level: env.PET_LEVEL || "PET",
    sourceType: env.SOURCE_TYPE ? parseInt(env.SOURCE_TYPE, 10) : 2,
    dist: env.DIST_DIR || path.join(ROOT, "dist"),
    corsOrigin: env.CORS_ORIGIN || "",
    db: {
      host: env.DB_HOST || "127.0.0.1",
      port: parseInt(env.DB_PORT || "3306", 10),
      user: env.DB_USER || "zhang",
      password: env.DB_PASS || "",
      database: env.DB_NAME || "bud"
    }
  };
}

export function createApp(db, opts) {
  opts = opts || {};
  const log = opts.log || console;
  const dist = opts.dist || "";
  const corsOrigin = opts.corsOrigin || "";

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  /* 跨域只在显式配置时开（本地拿 python http.server 开 dist 联调才会用到）。
     正常部署是同源 /api，没有这一层。 */
  if (corsOrigin) {
    app.use(function (req, res, next) {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });
  }

  function bad(res, err) {
    return res.status(400).json({ ok: false, err: err });
  }
  /* 路由里拿手机号：校验不过直接 400 */
  function phoneOf(res, raw) {
    const p = normPhone(raw);
    if (!validPhone(p)) { bad(res, "手机号格式不对"); return null; }
    return p;
  }

  app.get("/api/health", async function (req, res, next) {
    try {
      await db.ping();
      res.json({ ok: true, db: "up" });
    } catch (e) { next(e); }
  });

  app.post("/api/register", async function (req, res, next) {
    try {
      const b = req.body || {};
      const phone = phoneOf(res, b.phone);
      if (!phone) return;
      const nickname = normNickname(b.nickname);
      if (!validNickname(b.nickname)) return bad(res, "昵称请填 1–16 个字");
      if (!validPassword(b.password)) return bad(res, "密码请填 6–64 位");

      const r = await db.registerUser({ phone: phone, nickname: nickname, passHash: hashPassword(b.password) });
      if (r.exists) return bad(res, "这个手机号已经注册过了，直接登录就行");
      const row = await db.getUserByPhone(phone);
      res.json({ ok: true, user: await db.userShape(row), completed: !!r.completed });
    } catch (e) { next(e); }
  });

  app.post("/api/login", async function (req, res, next) {
    try {
      const b = req.body || {};
      const phone = phoneOf(res, b.phone);
      if (!phone) return;
      if (!b.password) return bad(res, "请填密码");

      const row = await db.getUserByPhone(phone);
      if (!row) return bad(res, "这个手机号还没注册，请先注册");
      if (!row.pass_hash) return bad(res, "这个手机号还没设过密码，点「注册」设置昵称和密码就行");
      if (!verifyPassword(b.password, row.pass_hash)) return bad(res, "密码不对，再试一次");

      res.json({ ok: true, user: await db.userShape(row) });
    } catch (e) { next(e); }
  });

  app.get("/api/me", async function (req, res, next) {
    try {
      const phone = phoneOf(res, req.query && req.query.phone);
      if (!phone) return;
      const row = await db.getUserByPhone(phone);
      /* 没这个号也返回 200 + user:null —— 前端拿它判「登录态已失效（比如清过库）」，
         不用把「查无此人」当成网络错误。 */
      res.json({ ok: true, user: row ? await db.userShape(row) : null });
    } catch (e) { next(e); }
  });

  app.post("/api/mistakes", async function (req, res, next) {
    try {
      const b = req.body || {};
      const phone = phoneOf(res, b.phone);
      if (!phone) return;
      const slug = String(b.slug == null ? "" : b.slug).trim();
      if (!SLUG_RE.test(slug)) return bad(res, "slug 不合法");
      const qN = parseInt(b.q, 10);
      if (!(qN >= 1 && qN <= 99)) return bad(res, "题号不合法");
      const chosen = String(b.chosen == null ? "" : b.chosen).trim().toUpperCase();
      const correct = String(b.correct == null ? "" : b.correct).trim().toUpperCase();
      if (!/^[A-Z]$/.test(chosen) || !/^[A-Z]$/.test(correct)) return bad(res, "选项字母不合法");

      await db.addMistake({ phone: phone, slug: slug, qN: qN, chosen: chosen, correct: correct });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get("/api/mistakes", async function (req, res, next) {
    try {
      const phone = phoneOf(res, req.query && req.query.phone);
      if (!phone) return;
      const r = await db.listMistakes(phone);
      res.json({ ok: true, items: r.items });
    } catch (e) { next(e); }
  });

  app.get("/api/favs", async function (req, res, next) {
    try {
      const phone = phoneOf(res, req.query && req.query.phone);
      if (!phone) return;
      const r = await db.listFavs(phone);
      res.json({ ok: true, items: r.items });
    } catch (e) { next(e); }
  });

  app.post("/api/favs/add", async function (req, res, next) {
    try {
      const b = req.body || {};
      const phone = phoneOf(res, b.phone);
      if (!phone) return;

      if (b.kind === "word") {
        const word = normWord(b.word);
        if (!word) return bad(res, "缺 word");
        if (word.length > WORD_MAX) return bad(res, "word 太长（最多 " + WORD_MAX + " 字符）");
        const r = await db.addWordFav({
          phone: phone,
          word: word,
          meaning: fitText(b.meaning || ""),
          phonetic: fitChars(b.phonetic || "", 128),   // pet_word.phonetic varchar(128)
          pos: fitChars(b.pos || "", 64),              // pet_word.pos varchar(64)
          mnemonic: fitText(b.mnemonic || ""),
          example: fitText(b.example || ""),
          exampleTranslation: fitText(b.exampleTranslation || ""),
          exampleAnalysis: fitText(b.exampleAnalysis || ""),
          phrase: fitText(b.phrase || ""),
          sourceTitle: fitText(b.sourceTitle || "", TITLE_MAX)
        });
        return res.json({ ok: true, wordId: r.wordId });
      }

      if (b.kind === "sentence") {
        const sentence = normSentence(b.sentence);
        if (!sentence) return bad(res, "缺 sentence");
        if (byteLen(sentence) > TEXT_MAX_BYTES) return bad(res, "句子太长");
        const r = await db.addSentenceFav({
          phone: phone,
          sentence: sentence,
          translation: fitText(b.translation || ""),
          analysis: fitText(b.analysis || ""),
          sourceTitle: fitText(b.sourceTitle || "", TITLE_MAX)
        });
        return res.json({ ok: true, sentenceId: r.sentenceId, hash: r.hash });
      }

      return bad(res, "kind 必须是 word 或 sentence");
    } catch (e) { next(e); }
  });

  app.post("/api/favs/remove", async function (req, res, next) {
    try {
      const b = req.body || {};
      const phone = phoneOf(res, b.phone);
      if (!phone) return;

      if (b.kind === "word") {
        const word = normWord(b.word);
        if (!word) return bad(res, "缺 word");
        const r = await db.removeWordFav({ phone: phone, word: word });
        return res.json({ ok: true, removed: r.removed });
      }
      if (b.kind === "sentence") {
        const sentence = normSentence(b.sentence);
        if (!sentence) return bad(res, "缺 sentence");
        if (byteLen(sentence) > TEXT_MAX_BYTES) return bad(res, "句子太长");
        const r = await db.removeSentenceFav({ phone: phone, sentence: sentence });
        return res.json({ ok: true, removed: r.removed });
      }
      return bad(res, "kind 必须是 word 或 sentence");
    } catch (e) { next(e); }
  });

  /* 本地联调：dist 存在时把静态站点也挂上（生产走 nginx） */
  if (dist && fs.existsSync(dist)) {
    app.use(express.static(dist));
  }

  /* 兜底错误处理：客户端错误给 400 级别的通用话术，其余 500。
     内部错误细节只进日志，不进响应。 */
  app.use(function (err, req, res, next) {   // eslint-disable-line no-unused-vars
    const code = err && (err.status || err.statusCode);
    log.error("[pet-api]", (err && err.message) || err);
    if (code >= 400 && code < 500) {
      return res.status(code).json({ ok: false, err: "请求不合法" });
    }
    res.status(500).json({ ok: false, err: "服务器开小差了" });
  });

  return app;
}

/* ---------- 直接运行：读环境变量、连库、起服务 ---------- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const cfg = configFromEnv();
  const { createPool, createDb } = await import("./db.mjs");
  const pool = createPool(cfg.db);
  const db = createDb(pool, { level: cfg.level, sourceType: cfg.sourceType });
  const app = createApp(db, { dist: cfg.dist, corsOrigin: cfg.corsOrigin });

  const srv = app.listen(cfg.port, cfg.host, function () {
    console.log("pet-api 已启动： http://" + cfg.host + ":" + cfg.port);
    console.log("  MySQL   " + cfg.db.user + "@" + cfg.db.host + ":" + cfg.db.port + "/" + cfg.db.database);
    console.log("  level   " + cfg.level + " · source_type " + cfg.sourceType);
    if (cfg.dist && fs.existsSync(cfg.dist)) console.log("  静态站点 " + cfg.dist + "（本地联调）");
  });
  function bye() {
    srv.close(function () { process.exit(0); });
  }
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}
