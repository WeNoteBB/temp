/* 把中文行文里被规范化的 ASCII 双引号转回全角弯引号
   判定规则（无状态，可重复运行）：
     - 后一个非空字符是  , : } ] ) ; 换行  → 这是 JS 字符串的结束定界符，保留
     - 后一个非空字符是  字母/数字/汉字     → 这是中文引号的左引号 “
     - 其余                                → 这是中文引号的右引号 ”
*/
const fs = require("fs");
const f = process.argv[2];
const s = fs.readFileSync(f, "utf8");
const BACKSLASH = String.fromCharCode(92);
const CLOSERS = [",", ":", "}", "]", ")", ";", "\n", "\r"];
const OPEN_NEXT = /[A-Za-z0-9一-鿿]/;

let out = "", inStr = false, open = 0, close = 0;

for (let i = 0; i < s.length; i++) {
  const c = s[i];
  if (c === BACKSLASH) { out += c + (s[i + 1] || ""); i++; continue; }
  if (c !== '"') { out += c; continue; }

  if (!inStr) { inStr = true; out += '"'; continue; }   // 字符串开始

  let j = i + 1;
  while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
  const nx = s[j];

  if (nx === undefined || CLOSERS.includes(nx)) {        // 字符串结束
    inStr = false; out += '"'; continue;
  }
  if (OPEN_NEXT.test(nx)) { out += "“"; open++; }   // 左引号
  else { out += "”"; close++; }                     // 右引号
}

fs.writeFileSync(f, out);
console.log("左引号 " + open + " / 右引号 " + close);
