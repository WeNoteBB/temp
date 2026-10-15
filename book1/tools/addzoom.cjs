/* 把「原文」和「小黑板」两栏里的字号改成随 --zoom 缩放。
   顶栏、历史浮层、页面骨架不在列表里，因此不受影响。
   一律用 calc(Npx * var(--zoom)) 而不是 em —— em 会随父元素逐层复合，
   比如 .part code 在 .pbody 里面，用 em 就会被放大两次。 */
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "src", "style.css");

// 要缩放的选择器 → 需要一起缩放的盒子属性
const SCALE = {
  ".col-head": [],
  ".col-head .hint": [],
  ".col-head .collapse": [["width", 22], ["height", 22]],
  ".passage-title": [],
  ".passage-meta": [],
  ".blank": [["min-width", 34], ["height", 22]],
  ".mini": [["width", 24], ["height", 22]],
  ".qsec-h": [],
  ".qnum": [["width", 27], ["height", 27]],
  ".qtxt": [],
  ".qans .lbl": [],
  ".qans .letter": [["width", 24], ["height", 24]],
  ".qans .atxt": [],
  ".btn": [],
  ".opt": [],
  ".ol": [["width", 22], ["height", 22]],
  ".tag": [],
  ".obtn": [],
  ".empty": [],
  ".empty .big": [],
  ".ana-h": [],
  ".ana-h .ana-spk": [],
  ".ana-sent": [],
  ".sec-t": [],
  ".sec-b": [],
  ".sec-b code": [],
  ".chip": [],
  ".part .pname": [],
  ".part .pbody": [],
  ".part code": [],
  ".qa-t": [],
  ".qa-b": [],
  ".qa-b code": [],
  ".vpos": [],
  ".traprow": []
};

let css = fs.readFileSync(file, "utf8");
let touched = 0, missed = [];

Object.keys(SCALE).forEach(sel => {
  // 找到该选择器的规则块（只取第一处，本文件里每个选择器只出现一次）
  const i = css.indexOf("\n" + sel + "{");
  if (i < 0) { missed.push(sel); return; }
  const start = i + 1;
  const end = css.indexOf("}", start);
  let block = css.slice(start, end);

  const before = block;
  block = block.replace(/font-size:(\d+(?:\.\d+)?)px/g,
    (m, n) => "font-size:calc(" + n + "px * var(--zoom))");
  SCALE[sel].forEach(([prop, val]) => {
    block = block.replace(new RegExp("\\b" + prop + ":" + val + "px", "g"),
      prop + ":calc(" + val + "px * var(--zoom))");
  });
  if (block !== before) { touched++; css = css.slice(0, start) + block + css.slice(end); }
});

fs.writeFileSync(file, css, "utf8");
console.log("改写了 " + touched + " 条规则");
if (missed.length) console.log("!! 没找到选择器：" + missed.join(", "));
const left = (css.match(/font-size:\d/g) || []).length;
console.log("仍为固定 px 的 font-size：" + left + " 处（应全部属于顶栏 / 历史 / 页面骨架）");
