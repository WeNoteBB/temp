/* 本地预览 pet-reading/dist/ 的极简静态服务（替代未安装的 python3 -m http.server）
   用法：node .serve-dist.mjs [端口]   —— 在仓库根目录跑
   注意：必须走 http://，双击 html（file://）会因门禁跳登录页 */
import http from "http";
import fs from "fs";
import path from "path";

const port = Number(process.argv[2] || 8899);
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "pet-reading", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";

    const file = path.join(root, urlPath);
    // 防目录穿越
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 " + urlPath);
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store", // 本地预览不缓存，改完刷新即见
      });
      res.end(buf);
    });
  })
  .listen(port, () => {
    console.log("PET 精读本地预览: http://localhost:" + port + "/");
    console.log("根目录: " + root);
    console.log("（会先跳登录页，随便填个 1[3-9] 开头的 11 位手机号即可）");
  });
