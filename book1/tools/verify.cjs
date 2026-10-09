/* 内容自检：词组是否真的出现在原文里、词条覆盖率、答案一致性 */
global.window = {};
require("../src/content.js");
const C = global.window.PET_CONTENT;

const TOKEN_RE = /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g;
const words = s => { const o = []; let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s)) !== null) if (m[2]) o.push(m[2].toLowerCase()); return o; };

/* ---- 1. 原文全文 ---- */
const sents = [];
C.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => sents.push({ ref: pi + "-" + si, ...s })));
const allWords = sents.flatMap(s => words(s.s));

console.log("段落 " + C.passage.paragraphs.length +
  " · 句子 " + sents.length +
  " · 词数 " + allWords.length +
  " · 长难句 " + sents.filter(s => s.hard).length);
if (allWords.length !== C.passage.words) console.log("  ⚠ 声明的词数 " + C.passage.words + " 与实际不符");
if (sents.length !== C.passage.sentences) console.log("  ⚠ 声明的句数 " + C.passage.sentences + " 与实际不符");

/* ---- 2. 词组必须在原文或选项里真实出现（相邻词序列） ---- */
const corpus = [
  " " + allWords.join(" ") + " ",
  ...Object.values(C.options).map(o => " " + words(o).join(" ") + " ")
];
const missPhrase = [];
C.phrases.forEach(p => {
  const k = p.toLowerCase().replace(/\s+/g, " ");
  if (!corpus.some(c => c.includes(" " + k + " "))) missPhrase.push(p);
});
console.log("\n词组 " + C.phrases.length + " 条（原文 + 选项 A–H），未命中 " + missPhrase.length + " 条");
missPhrase.forEach(p => console.log("  ✗ " + p));
C.phrases.forEach(p => {
  const k = p.toLowerCase().replace(/\s+/g, " ");
  if (!C.glossary[k]) console.log("  ⚠ 词组无词条：" + p);
});

/* ---- 3. 词条覆盖率 ---- */
const uniq = [...new Set(allWords)];
const dedouble = s => /([bdfglmnprt])\1$/.test(s) ? s.slice(0, -1) : null;
function hit(w) {
  const cands = [w];
  const add = x => { if (x && x.length > 1 && !cands.includes(x)) cands.push(x); };
  if (/[’']s$/.test(w)) add(w.replace(/[’']s$/, ""));
  if (w.slice(-3) === "ies") add(w.slice(0, -3) + "y");
  if (w.slice(-4) === "ives") add(w.slice(0, -4) + "ife");
  if (w.slice(-2) === "es") add(w.slice(0, -2));
  if (w.slice(-1) === "s") add(w.slice(0, -1));
  if (w.slice(-3) === "ing") { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); add(dedouble(w.slice(0, -3))); }
  if (w.slice(-2) === "ed") { add(w.slice(0, -2)); add(w.slice(0, -1)); add(dedouble(w.slice(0, -2))); }
  if (w.slice(-2) === "er") { add(w.slice(0, -2)); add(dedouble(w.slice(0, -2))); }
  if (w.slice(-3) === "est") { add(w.slice(0, -3)); add(dedouble(w.slice(0, -3))); }
  return cands.some(c => C.glossary[c]);
}
const missing = uniq.filter(w => !hit(w));
console.log("\n不重复词形 " + uniq.length + " 个，词表覆盖 " + (uniq.length - missing.length) +
  " 个（" + Math.round((uniq.length - missing.length) / uniq.length * 100) + "%）");
if (missing.length) console.log("  未收录：" + missing.join(", "));

/* ---- 4. 答案一致性 ---- */
console.log("\n答案：");
const used = new Set();
C.questions.forEach(q => {
  if (used.has(q.answer)) console.log("  ⚠ 选项 " + q.answer + " 被用了两次");
  used.add(q.answer);
  const ok = C.options[q.answer] ? "✓" : "✗ 选项不存在";
  console.log("  " + q.n + " → " + q.answer + " " + ok + "  " + (C.options[q.answer] || "").slice(0, 46));
});
const extra = Object.keys(C.options).filter(L => !used.has(L));
console.log("  干扰项：" + extra.join(", ") + "（应为 3 个）" + (extra.length === 3 ? " ✓" : " ⚠"));

/* ---- 5. 句型字段 ---- */
const MAIN_PAT = ["主谓宾", "主系表", "主谓双宾", "主谓", "倒装引语"];
const badPat = [];
const patTally = {};
sents.forEach(s => {
  const p = s.ana && s.ana.pat;
  if (!Array.isArray(p) || !p.length) { badPat.push(s.ref + " 缺 pat"); return; }
  if (MAIN_PAT.indexOf(p[0]) < 0) badPat.push(s.ref + " 主句型不在白名单：" + p[0]);
  patTally[p[0]] = (patTally[p[0]] || 0) + 1;
});
console.log("\n句型：" + (badPat.length === 0 ? "22 句全部合规 ✓" : badPat.length + " 句有问题"));
badPat.forEach(b => console.log("  ✗ " + b));
console.log("  主句型分布：" + Object.keys(patTally).map(k => k + "×" + patTally[k]).join("  "));

/* ---- 6. ana.phrases 全量对照 ----
   界面上「本句词组」以自动推导为准，手打条目里凡是没被推导命中的
   会显示成虚线 chip。这里把非字面条目如实列出，人工过一眼：
     · 含省略号的（as ... as / prepare ... for）—— 结构写法，正常
     · 原形与正文变形不同的（lead a team / was leading a team）—— 正常
     · 其余 —— 疑似笔误，该修 */
const phraseSet = new Set(C.phrases.map(p => p.toLowerCase().replace(/\s+/g, " ")));
const nonLiteral = [];
sents.forEach(s => {
  const seq = " " + words(s.s).map(w => w.toLowerCase()).join(" ") + " ";
  (s.ana && s.ana.phrases || []).forEach(m => {
    const k = m.toLowerCase().replace(/\s+/g, " ").trim();
    if (!seq.includes(" " + k + " ")) {
      nonLiteral.push({ ref: s.ref, m, inTable: phraseSet.has(k) });
    }
  });
});
console.log("\n手打词组非字面条目 " + nonLiteral.length + " 处（会显示为虚线 chip）：");
nonLiteral.forEach(d => console.log("  " + (d.inTable ? "⚠ 在词组表里但正文没有 → 疑似漂移" : "· ") +
  " " + d.ref + "  「" + d.m + "」"));

/* ---- 7. 原文复原（供人工比对） ---- */
if (process.argv[2] === "--dump") {
  console.log("\n===== 原文 =====\n");
  C.passage.paragraphs.forEach((p, i) => {
    console.log("[" + (i + 1) + "] " + p.map(s => s.s).join(" ")
      .replace(/\{(\d+)\}/g, (m, n) => "\n    《" + n + ":" + C.options[C.questions.find(q => q.n == n).answer] + "》\n"));
    console.log();
  });
}
