/* 把 src/ 下的源文件合成单个自包含 HTML */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = p => fs.readFileSync(path.join(root, "src", p), "utf8");
const guard = s => s.replace(/<\/script>/gi, "<\\/script>");

const html = src("template.html")
  .replace("/*__CSS__*/", () => src("style.css"))
  .replace("/*__CONTENT__*/", () => guard(src("content.js")))
  .replace("/*__APP__*/", () => guard(src("app.js")));

const out = path.join(root, "PET精读-Digging into the past.html");
fs.writeFileSync(out, html, "utf8");
console.log("✓ 已生成 " + path.basename(out) + "  (" + (html.length / 1024).toFixed(1) + " KB)");
