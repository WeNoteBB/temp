/* 通用视频课 · 上传前整理（把 data/videos.json 里的源文件转成网页友好的 MP4）
   ================================================================
   做的事：
     · 读 data/videos.json 的 fileName（原始文件）和 playName（目标文件名）；
     · 从 --dir 指定的目录找源文件；
     · 统一输出到 --out 目录，文件名用 01.mp4 … 26.mp4；
     · 原来是 H.264/AAC 的只换容器（快、无损）；H.265/其他编码才转码；
     · 加 -movflags +faststart，浏览器可以边下边播。

   用法（在 pet-reading/ 下）：
     node tools/prepare-videos.mjs --dir "D:\\BaiduNetdiskDownload\\【2025秋下】六年级数学A+ 洪然 （完结）" --out videos-out
     node tools/prepare-videos.mjs --dir "..." --out videos-out --dry
     node tools/prepare-videos.mjs --dir "..." --out videos-out --only 1,2

   ⚠ 需要本机装好 ffmpeg 和 ffprobe（PATH 里能直接调用）。
   ⚠ 这个脚本只整理文件，不上传；整理完把 --out 目录里的 01.mp4… 上传到
     ECS 的 /var/www/html/videos/math/grade6/2025autumn/（或改 data/videos.json 的 urlPrefix）。
*/

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const FORCE = argv.includes("--force");
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : "";
};
const SRC_DIR = getArg("--dir");
const OUT_DIR = getArg("--out") || path.join(root, "videos-out");
const ONLY = (getArg("--only") || "").split(",").map(x => parseInt(x, 10)).filter(x => x > 0);

if (!SRC_DIR) {
  console.error("✗ 缺 --dir：源视频所在目录");
  console.error('  例：node tools/prepare-videos.mjs --dir "D:\\BaiduNetdiskDownload\\【2025秋下】六年级数学A+ 洪然 （完结）" --out videos-out');
  process.exit(1);
}
if (!fs.existsSync(SRC_DIR)) {
  console.error("✗ 源目录不存在：" + SRC_DIR);
  process.exit(1);
}

let D;
try { D = JSON.parse(fs.readFileSync(path.join(root, "data", "videos.json"), "utf8")); }
catch (e) { console.error("✗ 读不到 data/videos.json：" + e.message); process.exit(1); }

const rows = (Array.isArray(D.videos) ? D.videos : []).slice().sort((a, b) => a.seq - b.seq);
if (!rows.length) { console.error("✗ data/videos.json 里没有 videos"); process.exit(1); }

function hasCmd(cmd) {
  const r = spawnSync(cmd, ["-version"], { encoding: "utf8" });
  return r.status === 0;
}
if (!DRY && (!hasCmd("ffmpeg") || !hasCmd("ffprobe"))) {
  console.error("✗ 找不到 ffmpeg / ffprobe。装好后重试：");
  console.error("  Windows: winget install Gyan.FFmpeg   （或从 ffmpeg.org 下载解压后把 bin 加进 PATH）");
  console.error("  Ubuntu:  sudo apt install -y ffmpeg");
  process.exit(1);
}

function probeCodec(file, kind) {
  const args = ["-v", "error", "-select_streams", kind + ":0", "-show_entries", "stream=codec_name",
    "-of", "default=nw=1:nk=1", file];
  const r = spawnSync("ffprobe", args, { encoding: "utf8" });
  if (r.status !== 0) return "";
  return String(r.stdout || "").trim().toLowerCase();
}

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y"].concat(args), { stdio: "inherit" });
  return r.status === 0;
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

let done = 0, skipped = 0, failed = 0;
for (const v of rows) {
  if (ONLY.length && ONLY.indexOf(v.seq) < 0) continue;
  const src = path.join(SRC_DIR, v.fileName);
  const out = path.join(OUT_DIR, v.playName);
  console.log("\n[" + v.seq + "] " + v.fileName + "  →  " + v.playName);

  if (!fs.existsSync(src)) {
    console.error("  ✗ 找不到源文件：" + src);
    failed++;
    continue;
  }
  if (!FORCE && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
    console.log("  · 已存在且比源文件新，跳过（--force 可强制重做）");
    skipped++;
    continue;
  }

  const vc = probeCodec(src, "v");
  const ac = probeCodec(src, "a");
  const canCopy = vc === "h264" && (!ac || ac === "aac");
  const common = ["-map", "0:v:0", "-map", "0:a:0?", "-movflags", "+faststart"];
  const args = canCopy
    ? ["-i", src].concat(common, ["-c", "copy", out])
    : ["-i", src].concat(common, ["-c:v", "libx264", "-preset", "medium", "-crf", "22",
        "-c:a", "aac", "-b:a", "128k", out]);

  console.log("  · 编码：视频 " + (vc || "?") + " / 音频 " + (ac || "无") + " → " + (canCopy ? "只换容器（无损）" : "转码 H.264/AAC"));
  if (DRY) {
    console.log("  · --dry：不执行 ffmpeg");
    continue;
  }
  if (runFfmpeg(args)) {
    const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
    console.log("  ✓ 完成：" + out + "（" + mb + " MB）");
    done++;
  } else {
    console.error("  ✗ ffmpeg 失败。可以手动试：");
    console.error('    ffmpeg -i "' + src + '" -c:v libx264 -crf 22 -c:a aac -movflags +faststart "' + out + '"');
    failed++;
  }
}

console.log("\n整理结束：完成 " + done + "，跳过 " + skipped + "，失败 " + failed);
console.log("输出目录：" + OUT_DIR);
if (failed) process.exitCode = 1;
