/* 一次性迁移：把旧工程的 src/content.js 转成 articles/*.json
   用法： node tools/migrate-legacy.mjs <旧 content.js 路径> <slug> [输出目录]
*/
import fs from "fs";
import path from "path";

const [legacyPath, slug, outDir = "articles"] = process.argv.slice(2);
if (!legacyPath || !slug) {
  console.error("用法: node tools/migrate-legacy.mjs <content.js> <slug> [outDir]");
  process.exit(1);
}

/* 旧文件是 window.PET_CONTENT = {...}，用假的 window 接住 */
const code = fs.readFileSync(legacyPath, "utf8");
const win = {};
new Function("window", code)(win);
const c = win.PET_CONTENT;
if (!c) { console.error("✗ 没读到 window.PET_CONTENT"); process.exit(1); }

/* 句子计数校验，防止迁移过程中丢句。
   分词必须沿用旧 verify.cjs 的 TOKEN_RE —— 只认字母序列（连字符/撇号算词内），
   按空白切分口径不同，会数出 322 而不是 319。 */
const TOKEN_RE = /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g;
const words = s => {
  const o = []; let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s)) !== null) if (m[2]) o.push(m[2].toLowerCase());
  return o;
};
const allSent = c.passage.paragraphs.flat();
const wordCount = allSent.reduce((n, s) => n + words(s.s).length, 0);

const article = {
  slug,
  book: "剑桥PET 官方模考题精讲讲练 23-24",
  label: c.meta.label,
  title: c.passage.title,
  note: c.meta.note,
  passage: {
    words: c.passage.words,
    sentences: c.passage.sentences,
    paragraphs: c.passage.paragraphs
  },
  phrases: c.phrases,
  glossary: c.glossary,
  options: c.options,
  optionsAna: c.optionsAna,
  questions: c.questions
};

fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, slug + ".json");
fs.writeFileSync(out, JSON.stringify(article, null, 2) + "\n", "utf8");

console.log("✓ 已写出 " + out);
console.log("  段落 " + article.passage.paragraphs.length +
            " · 句 " + allSent.length + "（声明 " + c.passage.sentences + "）" +
            " · 词 " + wordCount + "（声明 " + c.passage.words + "）");
console.log("  词组 " + article.phrases.length +
            " · 词条 " + Object.keys(article.glossary).length +
            " · 选项 " + Object.keys(article.options).length +
            " · 题目 " + article.questions.length);

/* 一致性自检：迁移不该改变任何计数 */
const bad = [];
if (allSent.length !== c.passage.sentences) bad.push("句数不符");
if (wordCount !== c.passage.words) bad.push("词数不符（" + wordCount + " vs " + c.passage.words + "）");
if (allSent.some(s => !s.ana)) bad.push("有句子缺 ana");
if (bad.length) { console.error("✗ " + bad.join("；")); process.exit(1); }
console.log("✓ 计数与源文件一致");
