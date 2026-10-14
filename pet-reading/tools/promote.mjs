/* 共享词库提取：把在多篇文章里重复出现的词条从各篇挪进 data/glossary.core.json
   用法：
     node tools/promote.mjs                预览（不动文件）
     node tools/promote.mjs --write        真的写
     node tools/promote.mjs --min 3 --write   出现 ≥3 篇才提升（默认 2）

   这是「词库全书化」的兑现机制：文章越攒越多，重复词条自动上浮，
   每篇要手写的词条越来越少。

   只提升「各篇释义完全一致」的词条。释义打架的留在原处并报出来 ——
   共用一条错的释义比各写各的更危险。
*/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...a) => path.join(root, ...a);
const readJSON = p => JSON.parse(fs.readFileSync(p, "utf8"));

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const mi = argv.indexOf("--min");
const MIN = mi >= 0 ? Number(argv[mi + 1]) : 2;

const manifest = readJSON(P("data", "manifest.json"));
const corePath = P("data", "glossary.core.json");
const core = readJSON(corePath);
const slugs = manifest.books.flatMap(b => b.articles);

/* ---------- 收集：词条 → 出现在哪些篇、各篇怎么写的 ---------- */
const seen = new Map();   // word → Map<slug, entry>
const where = new Map();  // word → Set<slug>

for (const slug of slugs) {
  const f = P("articles", slug + ".json");
  if (!fs.existsSync(f)) { console.error("! 跳过缺失的 " + slug); continue; }
  const A = readJSON(f);
  Object.entries(A.glossary || {}).forEach(([w, e]) => {
    if (!seen.has(w)) { seen.set(w, new Map()); where.set(w, new Set()); }
    seen.get(w).set(slug, e);
    where.get(w).add(slug);
  });
}

/* ---------- 分类 ---------- */
const promote = [];    // 可以提升的
const conflict = [];   // 各篇释义不一致
const already = [];    // 已经在共享词库里

for (const [w, bySlug] of seen) {
  if (bySlug.size < MIN) continue;
  if (core[w]) { already.push(w); continue; }

  const forms = new Set([...bySlug.values()].map(e => JSON.stringify({
    pos: e.pos || "", ipa: e.ipa || "", cn: e.cn || "", note: e.note || ""
  })));
  if (forms.size > 1) {
    conflict.push({ w, bySlug, forms: [...forms] });
  } else {
    promote.push({ w, entry: [...bySlug.values()][0], count: bySlug.size });
  }
}

/* ---------- 报告 ---------- */
console.log("扫描 " + slugs.length + " 篇");
console.log("  可提升到共享词库：" + promote.length + " 条（出现在 ≥" + MIN + " 篇且释义一致）");
console.log("  释义打架、暂不提升：" + conflict.length + " 条");
console.log("  已在共享词库里：" + already.length + " 条");
console.log("  共享词库现有：" + Object.keys(core).length + " 条");

if (promote.length) {
  console.log("\n按复用篇数排序的前 30 条：");
  promote.sort((a, b) => b.count - a.count || a.w.localeCompare(b.w));
  promote.slice(0, 30).forEach(p => {
    const cn = String(p.entry.cn || "").replace(/<[^>]+>/g, "").slice(0, 22);
    console.log("  " + String(p.count).padStart(2) + " 篇  " + p.w.padEnd(18) + cn);
  });
  if (promote.length > 30) console.log("  … 另有 " + (promote.length - 30) + " 条");
}

if (conflict.length) {
  console.log("\n⚠ 释义打架（必须人工统一，共享词库只能有一个版本）：");
  conflict.slice(0, 20).forEach(c => {
    console.log("  「" + c.w + "」出现在 " + [...c.bySlug.keys()].join(", "));
    c.forms.forEach(f => {
      const o = JSON.parse(f);
      console.log("      " + (o.cn || "(无释义)").slice(0, 60));
    });
  });
  if (conflict.length > 20) console.log("  … 另有 " + (conflict.length - 20) + " 条");
}

if (!WRITE) {
  console.log("\n（预览模式，没有改动任何文件。加 --write 真的提升）");
  process.exit(conflict.length ? 1 : 0);
}

/* ---------- 写入 ---------- */
promote.forEach(p => { core[p.w] = p.entry; });
const sorted = Object.fromEntries(Object.keys(core).sort().map(k => [k, core[k]]));
fs.writeFileSync(corePath, JSON.stringify(sorted, null, 2) + "\n", "utf8");

/* 从各篇里删掉已提升的词条 */
let removed = 0;
for (const slug of slugs) {
  const f = P("articles", slug + ".json");
  if (!fs.existsSync(f)) continue;
  const A = readJSON(f);
  let touched = false;
  promote.forEach(p => {
    if (A.glossary && A.glossary[p.w]) { delete A.glossary[p.w]; removed++; touched = true; }
  });
  if (touched) fs.writeFileSync(f, JSON.stringify(A, null, 2) + "\n", "utf8");
}

console.log("\n✓ 已提升 " + promote.length + " 条到 data/glossary.core.json");
console.log("  从各篇删掉重复词条 " + removed + " 处");
console.log("  共享词库现在 " + Object.keys(core).length + " 条");
if (conflict.length) {
  console.log("\n✗ 还有 " + conflict.length + " 条释义打架没处理，先统一再跑一次");
  process.exit(1);
}
