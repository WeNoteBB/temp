/* 内容自检（纯数据，不需要浏览器）
   用法：
     node tools/verify.mjs              校验 manifest 里的全部文章
     node tools/verify.mjs <slug>       只校验一篇
   退出码非 0 表示有「错误」，可直接用在 CI / 提交钩子里。
   警告不影响退出码。
*/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...a) => path.join(root, ...a);
const read = p => fs.readFileSync(p, "utf8");
const readJSON = p => JSON.parse(read(p));

const manifest = readJSON(P("data", "manifest.json"));
const core = readJSON(P("data", "glossary.core.json"));

/* ---------- 分词：必须与引擎一致 ----------
   只认字母序列，连字符 / 撇号算词内（no-one、wasn't 都是一个 token）。 */
const TOKEN_RE = /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g;
const words = s => {
  const o = []; let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s)) !== null) if (m[2]) o.push(m[2].toLowerCase());
  return o;
};
const slots = s => { const o = []; let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s)) !== null) if (m[1]) o.push(+m[1]); return o; };

/* ---------- 查词回退（与引擎的 hit 逻辑一致） ---------- */
const dedouble = s => /([bdfglmnprt])\1$/.test(s) ? s.slice(0, -1) : null;
function lookup(g, w) {
  const c = [w];
  const add = x => { if (x && x.length > 1 && !c.includes(x)) c.push(x); };
  if (/[’']s$/.test(w)) add(w.replace(/[’']s$/, ""));
  if (w.slice(-3) === "ies") add(w.slice(0, -3) + "y");
  if (w.slice(-4) === "ives") add(w.slice(0, -4) + "ife");
  if (w.slice(-2) === "es") add(w.slice(0, -2));
  if (w.slice(-1) === "s") add(w.slice(0, -1));
  if (w.slice(-3) === "ing") { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); add(dedouble(w.slice(0, -3))); }
  if (w.slice(-2) === "ed") { add(w.slice(0, -2)); add(w.slice(0, -1)); add(dedouble(w.slice(0, -2))); }
  if (w.slice(-2) === "er") { add(w.slice(0, -2)); add(dedouble(w.slice(0, -2))); }
  if (w.slice(-3) === "est") { add(w.slice(0, -3)); add(dedouble(w.slice(0, -3))); }
  return c.find(x => g[x]) || null;
}

const MAIN_PAT = ["主谓宾", "主系表", "主谓双宾", "主谓", "倒装引语"];
const ANA_FIELDS = ["pat", "frame", "parts", "clauses", "gram", "tip"];

/* ---------- 校验框架 ---------- */
let errCount = 0, warnCount = 0;
const ERR = [], WARN = [];
const err = m => { errCount++; ERR.push(m); };
const warn = m => { warnCount++; WARN.push(m); };

/* ============================================================
   单篇校验
   ============================================================ */
function verifyArticle(slug) {
  const file = P("articles", slug + ".json");
  if (!fs.existsSync(file)) { err(slug + "：找不到 articles/" + slug + ".json"); return null; }

  const A = readJSON(file);
  const g = Object.assign({}, core, A.glossary || {});

  /* --- 基本字段 --- */
  if (A.slug !== slug) err(`${slug}：文件里的 slug 是「${A.slug}」，与文件名不符`);
  ["title", "label", "note"].forEach(k => { if (!A[k]) err(`${slug}：缺 ${k}`); });
  if (!A.passage || !Array.isArray(A.passage.paragraphs)) { err(slug + "：缺 passage.paragraphs"); return null; }

  /* --- 句子与词数 --- */
  const sents = [];
  A.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => sents.push({ ref: pi + "-" + si, ...s })));
  const allWords = sents.flatMap(s => words(s.s));
  if (sents.length !== A.passage.sentences) err(`${slug}：声明 ${A.passage.sentences} 句，实际 ${sents.length} 句`);
  if (allWords.length !== A.passage.words) err(`${slug}：声明 ${A.passage.words} 词，实际 ${allWords.length} 词`);

  /* --- 每句必须有完整 ana --- */
  sents.forEach(s => {
    if (!s.tr) warn(`${slug} ${s.ref}：缺 tr 翻译`);
    if (!s.ana) { err(`${slug} ${s.ref}：缺 ana`); return; }
    ANA_FIELDS.forEach(f => { if (!s.ana[f]) err(`${slug} ${s.ref}：ana 缺 ${f}`); });
    const pat = s.ana.pat;
    if (!Array.isArray(pat) || !pat.length) err(`${slug} ${s.ref}：pat 为空`);
    else if (MAIN_PAT.indexOf(pat[0]) < 0) err(`${slug} ${s.ref}：主句型「${pat[0]}」不在白名单`);
  });

  /* --- 选项分析同样要有 ana --- */
  Object.keys(A.options || {}).forEach(L => {
    const oa = A.optionsAna && A.optionsAna[L];
    if (!oa) { err(`${slug}：选项 ${L} 缺 optionsAna`); return; }
    ANA_FIELDS.forEach(f => { if (!oa[f]) err(`${slug}：选项 ${L} 的 optionsAna 缺 ${f}`); });
    if (oa.tr === undefined) warn(`${slug}：选项 ${L} 的 optionsAna 缺 tr`);
  });

  /* --- 词组：必须在原文或选项里逐词出现 --- */
  const corpus = [
    " " + allWords.join(" ") + " ",
    ...Object.values(A.options || {}).map(o => " " + words(o).join(" ") + " ")
  ];
  (A.phrases || []).forEach(p => {
    const k = p.toLowerCase().replace(/\s+/g, " ");
    if (!corpus.some(c => c.includes(" " + k + " "))) err(`${slug}：词组「${p}」在原文和选项里都找不到`);
    if (!g[k]) err(`${slug}：词组「${p}」没有词条，点开是空的`);
  });

  /* --- 词形覆盖率 100%（原文 + 选项，一个都不能漏） --- */
  const optionWords = Object.values(A.options || {}).flatMap(o => words(o));
  const uniq = [...new Set(allWords.concat(optionWords))];
  const missing = uniq.filter(w => !lookup(g, w));
  if (missing.length) {
    err(`${slug}：词表覆盖率 ${uniq.length - missing.length}/${uniq.length}，缺 ${missing.length} 个 → ` +
        missing.join(", "));
  }

  /* --- 空位与答案 --- */
  const found = [...new Set(sents.flatMap(s => slots(s.s)))].sort((a, b) => a - b);
  const qs = A.questions || [];
  const qns = qs.map(q => q.n).sort((a, b) => a - b);
  if (found.join() !== qns.join()) err(`${slug}：原文空位 [${found}] 与题目 [${qns}] 对不上`);
  if (qs.length !== 5) warn(`${slug}：题目 ${qs.length} 道（Part 4 应为 5 道）`);

  const used = new Set();
  qs.forEach(q => {
    if (used.has(q.answer)) err(`${slug}：选项 ${q.answer} 被两题同时选为答案`);
    used.add(q.answer);
    if (!A.options || !A.options[q.answer]) err(`${slug}：第 ${q.n} 题答案 ${q.answer} 不在 options 里`);
    ["why", "clues", "tip", "prompt"].forEach(f => { if (!q[f]) err(`${slug}：第 ${q.n} 题缺 ${f}`); });
    const others = q.others || [];
    if (others.length < 3) warn(`${slug}：第 ${q.n} 题的 others 只有 ${others.length} 条（建议 3–7 条）`);
    others.forEach(o => {
      if (!Array.isArray(o) || o.length !== 2) err(`${slug}：第 ${q.n} 题的 others 有条目不是 [字母, 说明]`);
      else if (!A.options || !A.options[o[0]]) err(`${slug}：第 ${q.n} 题的 others 提到不存在的选项 ${o[0]}`);
      else if (o[0] === q.answer) err(`${slug}：第 ${q.n} 题的 others 里出现了它自己的答案 ${o[0]}`);
    });
  });
  const distractors = Object.keys(A.options || {}).filter(L => !used.has(L));
  if (distractors.length !== 3) err(`${slug}：干扰项 ${distractors.length} 个（应为 3 个）→ ${distractors.join(",")}`);

  /* 功能不变量：干扰项必须在某一题的 others 里出现过。
     引擎在「答题解析」里靠 others 汇总「它为什么哪个空都不填」，
     一次都没出现的干扰项点开就是空面板。 */
  const mentioned = new Set(qs.flatMap(q => (q.others || []).map(o => o[0])));
  distractors.filter(L => !mentioned.has(L)).forEach(L =>
    err(`${slug}：干扰项 ${L} 在任何一题的 others 里都没出现，点它的「答题解析」会是空的`));

  /* --- 手打 ana.phrases 与正文实际词组的漂移 --- */
  const phraseSet = new Set((A.phrases || []).map(p => p.toLowerCase().replace(/\s+/g, " ")));
  const drift = [];
  sents.forEach(s => {
    const seq = " " + words(s.s).join(" ") + " ";
    ((s.ana && s.ana.phrases) || []).forEach(m => {
      const k = m.toLowerCase().replace(/\s+/g, " ").trim();
      if (!seq.includes(" " + k + " ") && phraseSet.has(k)) drift.push(s.ref + "「" + m + "」");
    });
  });
  if (drift.length) warn(`${slug}：${drift.length} 处 ana.phrases 在词组表里但正文没有（疑似漂移）→ ` + drift.join(" "));

  return {
    slug, A,
    uniq: uniq.length,
    own: Object.keys(A.glossary || {}).length,
    stat: {
      para: A.passage.paragraphs.length, sent: sents.length, word: allWords.length,
      hard: sents.filter(s => s.hard).length,
      phrase: (A.phrases || []).length,
      gloss: Object.keys(g).length,
      fromCore: Object.keys(g).length - Object.keys(A.glossary || {}).length
    }
  };
}

/* ============================================================
   引擎自检
   ============================================================
   上面校验的是「内容」，这里校验的是「引擎本身的不变量」——
   都是那种改错了不会报错、只会悄悄烂掉的东西。
   放在 verify 里是因为它跑在 check 的第一位，出问题立刻看得见。 */
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

/* 配平花括号找一整个块（正则数不清嵌套）。open 是左花括号的下标。 */
function balanced(src, open) {
  let d = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}" && --d === 0) break;
  }
  return { start: open, body: src.slice(open + 1, i), end: i + 1 };
}

/* 剥掉 @media 的壳（里面的规则要看得见），整块丢掉 @keyframes / @font-face
   （它们的 from/to 不是选择器，留着会被当成组件规则误报）。 */
function flattenCSS(src) {
  let out = "", i = 0;
  while (i < src.length) {
    const at = src.indexOf("@", i);
    if (at < 0) { out += src.slice(i); break; }
    out += src.slice(i, at);
    const open = src.indexOf("{", at);
    if (open < 0) break;
    const name = (src.slice(at, at + 40).match(/^@([a-z-]+)/i) || [])[1];
    const blk = balanced(src, open);
    if (name === "media") out += flattenCSS(blk.body);
    i = blk.end;
  }
  return out;
}

/* 一个色值算不算「跟主题有关」：纯黑白灰（r=g=b）在亮暗下都成立，
   比如阴影和遮罩本来就该是黑的；含 var() 的是令牌算出来的。其余的必须提成令牌。 */
function isThemeAgnostic(lit) {
  if (/var\(/.test(lit)) return true;
  const channels = s => {
    const c = s.match(/[0-9a-fA-F]{2}/g) || [];
    return c.slice(0, 3).map(x => x.toLowerCase());
  };
  if (lit[0] === "#") {
    /* #fa0 / #fa08 要先展开成 6 位再比 —— 按十进制数字抓会把 #ff00ff 抓成 [0]，
       长度不够就当成人畜无害放过去，那正好漏掉最该抓的那种纯色。 */
    const h = lit.slice(1);
    const full = (h.length === 3 || h.length === 4) ? [...h.slice(0, 3)].map(c => c + c).join("") : h.slice(0, 6);
    if (full.length < 6 || !/^[0-9a-f]{6}$/.test(full)) return true;
    const [r, g, b] = channels(full);
    return r === g && g === b;
  }
  const nums = (lit.match(/\d+(?:\.\d+)?/g) || []).slice(0, 3).map(Number);
  if (nums.length < 3) return true;
  return nums[0] === nums[1] && nums[1] === nums[2];
}

function verifyEngine() {
  const need = ["app.js", "store.js", "style.css", "template.html", "login.template.html"];
  need.forEach(f => { if (!fs.existsSync(P("engine", f))) err("engine/" + f + " 不存在"); });

  /* --- store.js 不许依赖内容数据 ---
     它要给登录页用，而登录页没有 PET_CONTENT。 */
  const store = fs.existsSync(P("engine", "store.js")) ? read(P("engine", "store.js")) : "";
  if (/PET_CONTENT/.test(stripComments(store))) err("engine/store.js 依赖了 PET_CONTENT（登录页会崩）");

  /* --- 分词器契约 ---
     引擎渲染、内容校验、骨架生成三处必须逐字一致，否则「校验通过但页面渲染错位」。 */
  const tokOf = (file) => {
    const m = stripComments(read(P(...file.split("/")))).match(/TOKEN_RE\s*=\s*(\/.+?\/g)/);
    return m ? m[1] : null;
  };
  const toks = [["engine/app.js", tokOf("engine/app.js")], ["tools/verify.mjs", tokOf("tools/verify.mjs")],
                ["tools/new.mjs", tokOf("tools/new.mjs")]];
  toks.forEach(([f, t]) => { if (!t) err(`${f} 里找不到 TOKEN_RE`); });
  const uniqTok = [...new Set(toks.map(t => t[1]).filter(Boolean))];
  if (uniqTok.length > 1) {
    err("分词正则三处不一致：\n" + toks.map(([f, t]) => `      ${f}: ${t}`).join("\n"));
  }

  /* --- 断点契约：JS 判宽窄用的值必须与 CSS 的 @media 一致 ---
     差 1px 就会出现「JS 以为在窄屏、CSS 按宽屏排」这种最难查的错位。 */
  const css = fs.existsSync(P("engine", "style.css")) ? read(P("engine", "style.css")) : "";
  const jsBp = (read(P("engine", "app.js")).match(/matchMedia\("\(max-width:(\d+)px\)"\)/) || [])[1];
  const cssBp = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => m[1]);
  if (!jsBp) err("engine/app.js 里找不到 max-width 断点");
  else if (cssBp.some(b => b !== jsBp)) {
    err(`断点不一致：app.js 用 ${jsBp}px，style.css 里还有 ${[...new Set(cssBp)].join("/")}px`);
  }

  /* --- 主题键名：store.js 与 build.mjs 的防闪烁脚本必须同名 ---
     不同名的表现是「切换能用，但每次刷新都闪一下」——不会报错，只是难看。 */
  const THEME_KEY = "pet:theme:v1";
  if (!store.includes(THEME_KEY)) err(`engine/store.js 里没有主题键 ${THEME_KEY}`);
  const build = read(P("build.mjs"));
  const themeHead = (build.match(/const THEME_HEAD = `([\s\S]*?)`;/) || [])[1] || "";
  if (!themeHead) err("build.mjs 里找不到 THEME_HEAD");
  else if (!themeHead.includes(THEME_KEY)) err(`build.mjs 的 THEME_HEAD 里没有主题键 ${THEME_KEY}`);
  /* 三个模板都必须用占位符，不能各写一份内联脚本 */
  ["template.html", "login.template.html"].forEach(f => {
    const t = read(P("engine", f));
    if (!t.includes("<!--THEME_HEAD-->")) err(`engine/${f} 少了 <!--THEME_HEAD--> 占位符`);
    if (/localStorage\.getItem\("pet:theme/.test(t)) err(`engine/${f} 里又内联了一份防闪烁脚本`);
  });

  /* --- 颜色必须走令牌 ---
     这条是黑暗模式的保鲜剂：直接在组件里写 #fff，暗色下就是一块白斑，
     而且不会报任何错。扫描时先挖掉令牌定义块本身。 */
  const cssNoTokens = stripComments(css)
    .replace(/:root(?:\[data-theme="dark"\])?\s*\{[\s\S]*?\n\}/g, m => m.replace(/[^\n]/g, " "));
  const litRe = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;
  const bad = [];
  let lm;
  while ((lm = litRe.exec(cssNoTokens)) !== null) {
    if (isThemeAgnostic(lm[0])) continue;
    bad.push(cssNoTokens.slice(0, lm.index).split("\n").length + " 行: " + lm[0]);
  }
  if (bad.length) {
    err(`style.css 里有 ${bad.length} 处写死的颜色（没走令牌，暗色下会露白）：\n      ` +
        bad.slice(0, 8).join("\n      "));
  }

  /* --- 靠 :hover 才显形的按钮，必须在触摸设备上常显 ---
     `opacity:0` + `.row:hover .btn{opacity:1}` 这套写法在手机上等于把按钮
     彻底藏起来（根本没有 hover），而且页面看着完全正常，只是永远点不到。
     历史条的删除键就这么坏过很久。规则：凡是写了 opacity:0 的选择器，
     都得在 @media(hover:none) 里找回 opacity。 */
  const src = stripComments(css);
  const hoverAt = src.search(/@media\s*\(hover:\s*none\)\s*\{/);
  let hoverBody = "", rest = src;
  if (hoverAt >= 0) {
    const blk = balanced(src, src.indexOf("{", hoverAt));
    hoverBody = blk.body;
    rest = src.slice(0, blk.start) + src.slice(blk.end);   // 这一块单独判，不进主扫描
  } else {
    warn("style.css 里没有 @media(hover:none) 块（靠 :hover 显形的按钮在触摸设备上会点不到）");
  }
  /* 收集「哪些选择器设了某种 opacity」 */
  const opacitySel = (text, re) => {
    const set = new Set();
    [...flattenCSS(text).matchAll(/([^{}]+)\{([^}]*)\}/g)].forEach(m => {
      if (re.test(m[2])) m[1].split(",").forEach(s => { if (s.trim()) set.add(s.trim()); });
    });
    return set;
  };
  const restore = opacitySel(hoverBody, /opacity\s*:\s*(?!0(?![.\d]))[\d.]+/);
  /* opacity:0 也用来做淡入的起点（遮罩层就是），那不是「藏起来的按钮」。
     只有「别处有 :hover 规则碰过它」的选择器才算悬停才显形。 */
  const hoverTouched = flattenCSS(rest).split("}")
    .filter(block => block.split("{")[0].includes(":hover"))
    .join(" ");
  const hidden = [...opacitySel(rest, /opacity\s*:\s*0(?![.\d])/)]
    .filter(s => hoverTouched.includes(s));
  const unhoverable = hidden.filter(s => !restore.has(s));
  if (unhoverable.length) {
    err(`这些选择器平时 opacity:0，却不在 @media(hover:none) 的常显名单里（触摸设备上点不到）：\n      ` +
        unhoverable.join("\n      "));
  }

  /* --- 暗色块必须存在且真的覆写了底色 --- */
  const dark = (css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/) || [])[1] || "";
  if (!dark) err('style.css 里没有 :root[data-theme="dark"] 令牌块');
  else if (!/--bg\s*:/.test(dark)) err("暗色块没有覆写 --bg（等于没换底色）");

  /* --- 每个模板引用的引擎文件都被 build.mjs 的扫描覆盖 --- */
  ["template.html", "login.template.html"].forEach(f => {
    const t = read(P("engine", f));
    [...t.matchAll(/<!--V:([A-Za-z0-9_.-]+)-->/g)].forEach(m => {
      if (!fs.existsSync(P("engine", m[1]))) err(`engine/${f} 引用了不存在的 engine/${m[1]}`);
    });
  });
}

verifyEngine();

/* ============================================================
   跑起来
   ============================================================ */
const only = process.argv[2];
const slugs = [];
manifest.books.forEach(b => b.articles.forEach(s => slugs.push(s)));
const dup = slugs.filter((s, i) => slugs.indexOf(s) !== i);
if (dup.length) err("manifest 里有重复 slug：" + [...new Set(dup)].join(", "));
if (only && slugs.indexOf(only) < 0) console.error("! " + only + " 不在 manifest 里，仍然校验文件本身");

const targets = only ? [only] : slugs;
const results = targets.map(verifyArticle).filter(Boolean);

/* ---------- 跨篇一致性 ---------- */
const byWord = new Map();
results.forEach(r => {
  Object.keys(r.A.glossary || {}).forEach(w => {
    if (!byWord.has(w)) byWord.set(w, []);
    byWord.get(w).push(r);
  });
});
let conflicts = 0;
byWord.forEach((list, w) => {
  if (list.length < 2) return;
  const ipas = new Set(), cns = new Set();
  list.forEach(r => {
    const e = r.A.glossary[w];
    if (e.ipa) ipas.add(e.ipa);
    if (e.cn) cns.add(e.cn);
  });
  if (ipas.size > 1) { conflicts++; warn(`跨篇冲突：「${w}」音标有 ${ipas.size} 种写法 → ${[...ipas].join("  ")}`); }
  if (cns.size > 1) { conflicts++; warn(`跨篇冲突：「${w}」释义有 ${cns.size} 种写法`); }
});

/* ---------- 报告 ---------- */
console.log("═".repeat(64));
results.forEach(r => {
  const s = r.stat;
  console.log(`${r.slug}`);
  console.log(`  ${s.para} 段 · ${s.sent} 句 · ${s.word} 词 · 长难句 ${s.hard} · ` +
              `词组 ${s.phrase} · 选项 ${Object.keys(r.A.options || {}).length} · 题 ${(r.A.questions || []).length}`);
  console.log(`  不重复词形 ${r.uniq} 个 · 本篇词条 ${r.own} 条` +
              (s.fromCore ? ` + 共享词库 ${s.fromCore} 条` : "（共享词库暂无命中）"));
});
console.log("═".repeat(64));
console.log(`共 ${results.length} 篇  ·  共享词库 ${Object.keys(core).length} 条`);

if (WARN.length) {
  console.log(`\n⚠ 警告 ${warnCount} 条`);
  WARN.forEach(w => console.log("  " + w));
}
if (ERR.length) {
  console.log(`\n✗ 错误 ${errCount} 条`);
  ERR.forEach(e => console.log("  " + e));
  console.log("\n✗ 校验未通过");
  process.exit(1);
}
console.log(`\n✓ 全部通过${warnCount ? "（有 " + warnCount + " 条警告）" : ""}`);
