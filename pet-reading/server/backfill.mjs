/* PET 精读后端 · 词表补全工具
   ================================================================
   把 pet_word 里「字段缺着」的词，用引擎的内容库（../articles/*.json）补全：
     音标 ← 词条 ipa · 词性 ← pos · 释义（仅当为空）
     例句 ← 该词出现的第一句原句（连同翻译/分析写进 pet_sentence，
            sentence_hash 一起补上，和收藏时同一套规则）
     搭配 ← 含这个词的词组
   顺带把 user_word 里空着的 source_type / source_title 补上（2=文章、文章标题）。

   规则：
     · **只填空字段，绝不动已有内容**（和收藏接口「先到先得」同一原则）
     · 反复跑不会坏（补过的词下次就没有可补的了）
     · 默认只预览（dry-run）；加 --write 才真写

   用法（在 server/ 目录下）：
     node --env-file=.env backfill.mjs            # 预览：会补什么，不动库
     node --env-file=.env backfill.mjs --write    # 真写

   词形解析（centuries → century）是照抄 engine/app.js 的 lookup 回退规则，
   别在这里发明新规则 —— 两边对不上的话，补出来的词条会跟页面显示不一致。
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configFromEnv } from "./server.mjs";
import { createPool } from "./db.mjs";
import { sha256Hex } from "./lib.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARTICLES = path.join(ROOT, "..", "articles");
const CORE = path.join(ROOT, "..", "data", "glossary.core.json");
const WRITE = process.argv.includes("--write");

/* ---------- 载入内容库 ---------- */
function loadArticles() {
  const list = fs.readdirSync(ARTICLES).filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(fs.readFileSync(path.join(ARTICLES, f), "utf8")))
    .filter(a => a && a.slug);
  return list;
}

function loadGlossary(articles) {
  const g = {};
  /* 共享词库在前，文章词库覆盖（和 build.mjs 的合并方向一致） */
  if (fs.existsSync(CORE)) {
    Object.assign(g, JSON.parse(fs.readFileSync(CORE, "utf8")));
  }
  articles.forEach(a => Object.assign(g, a.glossary || {}));
  return g;
}

function dedouble(s) {
  return /([bdfglmnprt])\1$/.test(s) ? s.slice(0, -1) : null;
}

/* engine/app.js lookup() 的照抄版：原形 → 小写 → 去屈折 */
function resolveKey(raw, glossary) {
  const low = String(raw || "").toLowerCase();
  if (!low) return null;
  const cands = [low];
  const add = x => { if (x && x.length > 1 && cands.indexOf(x) < 0) cands.push(x); };
  if (/['’]s$/.test(low)) add(low.replace(/['’]s$/, ""));
  if (low.slice(-3) === "ies") add(low.slice(0, -3) + "y");
  if (low.slice(-4) === "ives") add(low.slice(0, -4) + "ife");
  if (low.slice(-2) === "es") add(low.slice(0, -2));
  if (low.slice(-1) === "s") add(low.slice(0, -1));
  if (low.slice(-3) === "ing") { add(low.slice(0, -3)); add(low.slice(0, -3) + "e"); add(dedouble(low.slice(0, -3))); }
  if (low.slice(-2) === "ed") { add(low.slice(0, -2)); add(low.slice(0, -1)); add(dedouble(low.slice(0, -2))); }
  if (low.slice(-2) === "er") { add(low.slice(0, -2)); add(dedouble(low.slice(0, -2))); }
  if (low.slice(-3) === "est") { add(low.slice(0, -3)); add(dedouble(low.slice(0, -3))); }
  for (const c of cands) if (glossary[c]) return c;
  return null;
}

/* ---------- 在文章里找例句 / 搭配 ---------- */
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function sentenceForms(word) {
  const forms = [word, word + "s", word + "es", word + "ed", word + "ing", word + "d"];
  if (word.slice(-1) === "y") forms.push(word.slice(0, -1) + "ies");
  if (word.slice(-1) === "e") forms.push(word.slice(0, -1) + "ing");
  return forms;
}

/* 该词出现的第一句（先正文、后选项；形状 {s, tr, ana}，和 anaData 一致） */
function firstSentence(article, word) {
  const forms = sentenceForms(word).map(escapeRe);
  const re = new RegExp("\\b(?:" + forms.join("|") + ")\\b", "i");
  const ps = (article.passage && article.passage.paragraphs) || [];
  for (const para of ps) {
    for (const s of para) {
      if (s && re.test(String(s.s))) return { s: s.s, tr: s.tr, ana: s.ana || null };
    }
  }
  const opts = article.options || {};
  for (const L of Object.keys(opts)) {
    if (re.test(String(opts[L]))) {
      const oa = (article.optionsAna || {})[L] || {};
      return { s: opts[L], tr: oa.tr, ana: oa.ana || oa || null };
    }
  }
  return null;
}

function phrasesWith(article, word) {
  const w = String(word).toLowerCase();
  return (article.phrases || []).filter(p => String(p).toLowerCase().split(/\s+/).indexOf(w) >= 0);
}

/* ---------- 主流程 ---------- */
const articles = loadArticles();
const glossary = loadGlossary(articles);
const byTitle = {};
articles.forEach(a => { if (a.title && !byTitle[a.title]) byTitle[a.title] = a; });

const cfg = configFromEnv();
const pool = createPool(cfg.db);

const isBlank = v => v == null || String(v).trim() === "";

try {
  await pool.query("SELECT 1");
  console.log("连接 " + cfg.db.host + ":" + cfg.db.port + "/" + cfg.db.database + "（" + (WRITE ? "写入模式" : "预览模式，不会动库") + "）");
  console.log("内容库：" + articles.length + " 篇 · 词条 " + Object.keys(glossary).length + " 条\n");

  const [words] = await pool.query(
    "SELECT id, word, meaning, phonetic, pos, example, phrase, sentence_hash FROM pet_word ORDER BY id");
  if (!words.length) {
    console.log("pet_word 是空的，没什么可补的。");
    process.exit(0);
  }

  /* 每行用户关联的 source_title（用来定位词是从哪篇来的） */
  const [links] = await pool.query(
    "SELECT id, word_id, level, source_type, source_title FROM user_word ORDER BY id");
  const titleOf = {};
  links.forEach(l => {
    if (l.source_title && !titleOf[l.word_id]) titleOf[l.word_id] = l.source_title;
  });

  let nPatchWord = 0, nPatchLink = 0, nSkip = 0, nNoMatch = 0;

  for (const row of words) {
    const key = resolveKey(row.word, glossary);
    const entry = key ? glossary[key] : null;
    const srcArticle = titleOf[row.id] && byTitle[titleOf[row.id]] ? byTitle[titleOf[row.id]] : null;

    /* 找例句：先在来源文章里找，再全库找 */
    let sent = null, sentArticle = null;
    const tryOrder = srcArticle ? [srcArticle].concat(articles.filter(a => a !== srcArticle)) : articles;
    for (const a of tryOrder) {
      const found = firstSentence(a, key || row.word);
      if (found) { sent = found; sentArticle = a; break; }
    }

    const want = {
      meaning: entry && entry.cn ? entry.cn : null,
      phonetic: entry && entry.ipa ? entry.ipa : null,
      pos: entry && entry.pos ? entry.pos : null,
      example: sent ? sent.s : null,
      phrase: (() => {
        const art = sentArticle || srcArticle;
        const phs = art ? phrasesWith(art, key || row.word) : [];
        return phs.length ? phs.join("\n") : null;
      })()
    };

    const fills = [];
    const sets = {}, params = [];
    for (const col of ["meaning", "phonetic", "pos", "example", "phrase"]) {
      if (isBlank(row[col]) && want[col]) { sets[col] = want[col]; fills.push(col + "「" + clip(want[col]) + "」"); }
    }

    /* 例句对应的句子要保证在 pet_sentence 里，并补 sentence_hash */
    let sentenceHash = row.sentence_hash || null;
    let mirrorInsert = null;
    const exampleText = sets.example || (isBlank(row.example) ? null : row.example);
    if (exampleText && isBlank(row.sentence_hash)) {
      sentenceHash = sha256Hex(exampleText);
      const tr = sets.example && sent ? (sent.tr || null) : null;
      const ana = sets.example && sent && sent.ana ? JSON.stringify(sent.ana) : null;
      mirrorInsert = [sentenceHash, exampleText, tr, ana];
      sets.sentence_hash = sentenceHash;
      fills.push("sentence_hash");
    }

    /* user_word：把空着的来源字段补上（2=文章） */
    const linkFix = [];
    if (sentArticle || srcArticle) {
      const title = (sentArticle || srcArticle).title;
      links.forEach(l => {
        if (l.word_id !== row.id) return;
        const upd = {};
        if (l.source_type == null) upd.source_type = 2;
        if (isBlank(l.source_title) && title) upd.source_title = title;
        if (Object.keys(upd).length) linkFix.push({ id: l.id, upd: upd });
      });
    }

    /* 打印这一行要做什么 */
    const head = pad(row.word, 18);
    if (!Object.keys(sets).length && !linkFix.length) {
      const why = key ? "没有可补的（字段都齐了）" : "词条表里找不到这个词，跳过了";
      console.log(head + "→ " + why);
      key ? nSkip++ : nNoMatch++;
      continue;
    }
    console.log(head + "→ 补：" + (fills.length ? fills.join("，") : "（无词条字段）") +
      (linkFix.length ? "；user_word 来源×" + linkFix.length : ""));

    if (WRITE) {
      if (Object.keys(sets).length) {
        const cols = Object.keys(sets);
        await pool.query(
          "UPDATE pet_word SET " + cols.map(c => "`" + c + "` = COALESCE(NULLIF(`" + c + "`, ''), ?)").join(", ") + " WHERE id = ?",
          cols.map(c => sets[c]).concat([row.id]));
        nPatchWord++;
      }
      if (mirrorInsert) {
        await pool.query(
          "INSERT INTO `pet_sentence` (`hash`, `sentence`, `sentence_translation`, `analysis`) " +
            "VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `id` = `id`",
          mirrorInsert);
      }
      for (const lf of linkFix) {
        await pool.query(
          "UPDATE user_word SET " + Object.keys(lf.upd).map(c => "`" + c + "` = ?").join(", ") + " WHERE id = ?",
          Object.values(lf.upd).concat([lf.id]));
        nPatchLink++;
      }
    } else if (Object.keys(sets).length) {
      nPatchWord++;  // 预览计数
    }
  }

  console.log("\n" + (WRITE ? "已补" : "将补") + "：单词 " + nPatchWord + " 条 · user_word 来源字段 " + nPatchLink + " 条" +
    (nSkip ? " · 无需补 " + nSkip + " 条" : "") + (nNoMatch ? " · 词表外 " + nNoMatch + " 条" : ""));
  if (!WRITE && nPatchWord) console.log("确认没问题后加 --write 真写。");
} catch (e) {
  console.error("中断：" + ((e && e.message) || e));
  if (/Access denied/i.test(String(e && e.message))) {
    console.error("  → 数据库拒绝了这个来源。部署机上跑： cd /opt/pet-api && /opt/node-v22/bin/node --env-file=.env backfill.mjs");
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}

function clip(s) { s = String(s).replace(/\s+/g, " "); return s.length > 30 ? s.slice(0, 30) + "…" : s; }
function pad(s, n) { s = String(s); return s + " ".repeat(Math.max(1, n - s.length)); }
