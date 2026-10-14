/* 新素材 → 文章骨架
   用法：
     node tools/new.mjs 素材.txt --slug t1-p3-xxx [--title "…"] [--label "…"]

   素材是纯文本，结构随意，认这几种行：
     title: xxx            文章标题
     label: xxx            出处标注（如 Exam Practice Test 1 · Reading Part 4）
     # 原文 / # 选项        段落分节
     正文按空行分段，空位写成 {16} (16) __16__ [16] 都认
     选项写成 "A ..." 或 "A. ..." 或 "A、..."

   产出：
     articles/<slug>.json  骨架 —— passage 已切好句、空位已标记，其余留 TODO
     屏幕上打印「还缺哪些词条」的清单，照着它补 glossary 即可

   注意：自动切句只是草稿。凡是被它切错的地方（缩写、引号里的句号）
   都要人工过一眼 —— 切错了后面全歪。
*/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...a) => path.join(root, ...a);

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const inputFile = argv.find(a => !a.startsWith("--"));
const flag = name => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : null; };
const slug = flag("slug");
if (!inputFile || !slug) {
  console.error("用法: node tools/new.mjs <素材.txt> --slug <slug> [--title \"…\"] [--label \"…\"]");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error("✗ slug 只能用小写字母、数字、连字符：" + slug);
  process.exit(1);
}
const outFile = P("articles", slug + ".json");
if (fs.existsSync(outFile)) {
  console.error("✗ articles/" + slug + ".json 已存在，先删掉或换个 slug");
  process.exit(1);
}

const raw = fs.readFileSync(inputFile, "utf8").replace(/\r\n?/g, "\n");

/* ---------- 拆节 ---------- */
const lines = raw.split("\n");
let title = flag("title") || "", label = flag("label") || "";
const sec = { passage: [], options: [] };
let cur = "passage";

for (const ln of lines) {
  const t = ln.trim();
  if (!t) { sec[cur].push(""); continue; }
  let m;
  if ((m = t.match(/^title\s*[:：]\s*(.+)$/i))) { title = title || m[1].trim(); continue; }
  if ((m = t.match(/^label\s*[:：]\s*(.+)$/i))) { label = label || m[1].trim(); continue; }
  if (/^#+\s*原文|^#+\s*passage/i.test(t)) { cur = "passage"; continue; }
  if (/^#+\s*选项|^#+\s*options/i.test(t)) { cur = "options"; continue; }
  sec[cur].push(ln);
}

/* ---------- 空位归一化 ----------
   素材里空位的写法五花八门，全部收敛成 {16}。
   裸露数字那条限制在 15–25 且后面紧跟大写字母，
   否则正文里的年份、价格会被误判成空位。 */
function normSlots(s) {
  return s
    .replace(/[{[(【]{1,3}\s*(\d{1,2})\s*[}\])】]{1,3}/g, (m, n) => "{" + n + "}")   // {16} [16] (16) 【16】
    .replace(/_{2,}\s*(\d{1,2})\s*_{2,}/g, (m, n) => "{" + n + "}")                  // __16__
    .replace(/\b(1[5-9]|2[0-5])\b(?=\s*[A-Z])/g, (m, n) => "{" + n + "}")            // 16 So the first…
    .replace(/\{\s*(\d+)\s*\}/g, "{$1}");                                            // 已经是好的
}

/* ---------- 切句 ----------
   在 . ! ? 之后切，但跳过常见缩写和单个大写字母（首字母缩写）。
   这是草稿，切错了要人工改。 */
const ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|e\.g|i\.e|No|Fig|approx)\.$/i;
const CLOSERS = new Set(['"', "”", "’", ")", "）", "』", "」"]);
function splitSentences(para) {
  const out = [];
  let buf = "";
  for (let i = 0; i < para.length; i++) {
    buf += para[i];
    const c = para[i];
    if (c !== "." && c !== "!" && c !== "?") continue;

    /* 句末标点后允许跟一串收尾引号/括号，它们属于本句：
       He said "Stop." Then left.  →  "Stop." 整块留在前一句 */
    let j = i;
    while (CLOSERS.has(para[j + 1])) buf += para[++j];

    /* 后面必须是空白或结尾，否则不是句末（3.5 / U.S. / e.g.） */
    const after = para[j + 1];
    if (after !== undefined && !/\s/.test(after)) { i = j; continue; }
    if (ABBR.test(buf.trim())) { i = j; continue; }
    if (c === "." && /\b[A-Z]\.$/.test(buf.trim())) { i = j; continue; }

    out.push(buf.trim());
    buf = "";
    let k = j + 1;
    while (para[k] === " ") k++;      // 吃掉句末空白，别让它变成下一句的开头
    i = k - 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/* ---------- 组装 passage ---------- */
const passageParas = sec.passage.join("\n").split(/\n\s*\n/)
  .map(p => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .map(p => normSlots(p));

const paragraphs = passageParas.map(p =>
  splitSentences(p).map(s => ({
    s,
    hard: false,
    tr: "",                                          // TODO 翻译
    ana: { pat: [], frame: "", parts: [], clauses: [], gram: [], tip: "" }   // TODO 句子分析
  }))
);

/* ---------- 组装 options ---------- */
const options = {};
sec.options.join("\n").split("\n").forEach(ln => {
  const m = ln.trim().match(/^([A-H])\s*[.、:：)）]?\s*(.+)$/);
  if (m) options[m[1]] = m[2].trim();
});

/* ---------- 统计 ---------- */
const TOKEN_RE = /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g;
const words = s => {
  const o = []; let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s)) !== null) if (m[2]) o.push(m[2].toLowerCase());
  return o;
};
const sents = paragraphs.flat();
const allWords = sents.flatMap(s => words(s.s));
const optWords = Object.values(options).flatMap(o => words(o));
const uniq = [...new Set(allWords.concat(optWords))];

/* ---------- 缺词清单：与共享词库对比 ---------- */
const core = JSON.parse(fs.readFileSync(P("data", "glossary.core.json"), "utf8"));
const dedouble = s => /([bdfglmnprt])\1$/.test(s) ? s.slice(0, -1) : null;
function resolves(w) {
  const c = [w]; const add = x => { if (x && x.length > 1 && !c.includes(x)) c.push(x); };
  if (/[’']s$/.test(w)) add(w.replace(/[’']s$/, ""));
  if (w.slice(-3) === "ies") add(w.slice(0, -3) + "y");
  if (w.slice(-2) === "es") add(w.slice(0, -2));
  if (w.slice(-1) === "s") add(w.slice(0, -1));
  if (w.slice(-3) === "ing") { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); add(dedouble(w.slice(0, -3))); }
  if (w.slice(-2) === "ed") { add(w.slice(0, -2)); add(w.slice(0, -1)); add(dedouble(w.slice(0, -2))); }
  if (w.slice(-2) === "er") { add(w.slice(0, -2)); add(dedouble(w.slice(0, -2))); }
  if (w.slice(-3) === "est") { add(w.slice(0, -3)); add(dedouble(w.slice(0, -3))); }
  return c.find(x => core[x]) || null;
}
const missing = uniq.filter(w => !resolves(w));

/* ---------- 写骨架 ---------- */
const article = {
  slug,
  book: (JSON.parse(fs.readFileSync(P("data", "manifest.json"), "utf8")).books[0] || {}).title || "",
  label: label || "TODO 出处标注",
  title: title || "TODO 标题",
  note: "答案为依据上下文推断，请核对书后答案",
  passage: { words: allWords.length, sentences: sents.length, paragraphs },
  phrases: [],
  glossary: {},
  options,
  optionsAna: Object.fromEntries(Object.keys(options).map(L =>
    [L, { pat: [], frame: "", parts: [], clauses: [], gram: [], tip: "", tr: "" }])),
  questions: []
};

fs.writeFileSync(outFile, JSON.stringify(article, null, 2) + "\n", "utf8");

/* ---------- 报告 ---------- */
console.log("✓ 骨架已写出 articles/" + slug + ".json");
console.log("  " + paragraphs.length + " 段 · " + sents.length + " 句 · " + allWords.length + " 词 · " +
  "选项 " + Object.keys(options).length + " 个");

const slots = [...new Set(sents.flatMap(s =>
  (s.s.match(/\{(\d+)\}/g) || []).map(x => parseInt(x.slice(1), 10))
))].filter(n => !isNaN(n)).sort((a, b) => a - b);
console.log("  空位：" + (slots.length ? slots.join(", ") : "★ 一个都没认出来 —— 检查素材里的空位写法"));

if (Object.keys(options).length !== 8) {
  console.log("  ⚠ 选项认到 " + Object.keys(options).length + " 个（Part 4 应为 A–H 共 8 个），检查素材格式");
}

console.log("\n切句结果（草稿，务必人工过一眼）：");
paragraphs.forEach((p, i) => {
  console.log("  [段 " + (i + 1) + "]");
  p.forEach((s, j) => console.log("    " + i + "-" + j + "  " + s.s.slice(0, 88) + (s.s.length > 88 ? "…" : "")));
});

console.log("\n还缺的词条：" + missing.length + " 个（不重复词形共 " + uniq.length + " 个，" +
  "共享词库已覆盖 " + (uniq.length - missing.length) + " 个）");
if (missing.length) {
  const W = 6;
  for (let i = 0; i < missing.length; i += W) {
    console.log("  " + missing.slice(i, i + W).map(w => w.padEnd(16)).join(""));
  }
}

console.log("\n下一步：");
console.log("  1. 核对上面的切句，切错的直接改 articles/" + slug + ".json 里的段落数组");
console.log("  2. 补 glossary（" + missing.length + " 条）：pos / ipa / cn，必要时加 note");
console.log("  3. 补每句的 tr 和 ana（pat / frame / parts / clauses / gram / tip）");
console.log("  4. 补 phrases、optionsAna、questions（5 题，答案互不重复，3 个干扰项）");
console.log("  5. node tools/verify.mjs " + slug + "   →  补到 0 错误");
console.log("  6. 把 slug 加进 data/manifest.json，跑 node build.mjs");
