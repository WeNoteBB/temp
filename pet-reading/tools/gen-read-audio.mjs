/* PET 词组库 · 预生成「本地跟读」音频
   ================================================================
   为什么：安卓/iOS 上浏览器经常没有 TTS（或只有机械音）。把每条词组的跟读
   预生成成 mp3 放 assets/read/<序号>.mp3，页面优先播文件，没有才退回 TTS。

   一条卡 = 4 句，顺序固定（和页面跟读一致）：
     ① 词组（英音） ② 中文意思（中文女声） ③ 例句（英音） ④ 例句翻译（中文女声）
   生成完拼成一个 mp3（纯字节拼接：Edge 输出同格式，实测时长 = 4 段之和）。

   用法：
     npm i -D msedge-tts
     node tools/gen-read-audio.mjs                 # 只补缺的（已有文件跳过）
     node tools/gen-read-audio.mjs --force         # 全部重做
     node tools/gen-read-audio.mjs --only 1,2,3    # 只做前三条
     node tools/gen-read-audio.mjs --voice-en en-GB-LibbyNeural --voice-zh zh-CN-XiaoxiaoNeural

   说明：走微软 Edge 的「朗读」接口（服务器端可用，不需要登录）；生成是开发机上的活，
   站点运行时只读 assets/read 下的静态文件，与这个脚本无关。
*/
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = JSON.parse(fs.readFileSync(path.join(root, "data", "phrases.json"), "utf8"));
const OUT_DIR = path.join(root, "assets", "read");
const TMP = path.join(os.tmpdir(), "pet-read-audio");
const FMT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const onlyIdx = args.indexOf("--only");
const ONLY = onlyIdx >= 0 ? String(args[onlyIdx + 1] || "").split(",").map(Number).filter(Boolean) : null;
const voiceArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const EN = voiceArg("--voice-en", "en-GB-LibbyNeural");
const ZH = voiceArg("--voice-zh", "zh-CN-XiaoxiaoNeural");

/* SSML 文本要转义，不然 & < > 会把请求弄坏 */
const xml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

let items = DATA.items || [];
if (ONLY) items = items.filter(x => ONLY.includes(x.n));
const todo = items.filter(x => FORCE || !fs.existsSync(path.join(OUT_DIR, x.n + ".mp3")));
console.log("词组 " + items.length + " 条；要做 " + todo.length + " 条" + (FORCE ? "（--force 全量）" : "（已有的跳过）"));
console.log("音色：英文 " + EN + " / 中文 " + ZH + "；格式 48kbps 单声道 mp3\n");

const tts = new MsEdgeTTS();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function say(text, voice, outFile) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await tts.setMetadata(voice, FMT);
      /* toFile 不会建目录（它只是把 dir + "/audio.mp3" 拼起来写文件）→ 目录得先建好。
         ⚠ outFile 本身就是 TMP 下的绝对路径，别再 join 一次 TMP（会拼出 TMP\TMP\…）。 */
      const dir = outFile.replace(/\.mp3$/, "");
      fs.mkdirSync(dir, { recursive: true });
      const r = await tts.toFile(dir, xml(text));
      if (!r || !r.audioFilePath || !fs.existsSync(r.audioFilePath)) throw new Error("没有拿到音频文件");
      fs.copyFileSync(r.audioFilePath, outFile);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
      const size = fs.statSync(outFile).size;
      if (size < 2000) throw new Error("文件太小（" + size + "B）");
      return size;
    } catch (e) {
      if (attempt === 4) throw e;
      console.warn("    ! 第 " + attempt + " 次失败（" + (e.message || e) + "），重试…");
      await sleep(600 * attempt);
    }
  }
}

const t0 = Date.now();
let done = 0, bytes = 0, failed = 0;
for (const it of todo) {
  const n = it.n, base = path.join(TMP, String(n));
  const parts = [
    { f: base + "-a.mp3", voice: EN, text: it.ph },
    { f: base + "-b.mp3", voice: ZH, text: it.cn },
    { f: base + "-c.mp3", voice: EN, text: it.ex },
    { f: base + "-d.mp3", voice: ZH, text: it.exCn }
  ];
  try {
    const bufs = [];
    for (const p of parts) {
      await say(p.text, p.voice, p.f);
      bufs.push(fs.readFileSync(p.f));
    }
    const out = path.join(OUT_DIR, n + ".mp3");
    fs.writeFileSync(out, Buffer.concat(bufs));
    parts.forEach(p => { try { fs.unlinkSync(p.f); } catch (e) {} });
    bytes += fs.statSync(out).size;
    done++;
    if (done % 10 === 0 || done === todo.length) {
      const sec = (Date.now() - t0) / 1000;
      const eta = done ? Math.round(sec / done * (todo.length - done)) : 0;
      console.log("  " + done + "/" + todo.length + "  " + (bytes / 1024 / 1024).toFixed(1) + " MB" +
        "  已用 " + Math.round(sec) + "s  预计还要 " + eta + "s");
    }
    await sleep(80);                                  // 温柔一点，别把接口打急
  } catch (e) {
    failed++;
    console.error("  ✗ " + n + " " + it.ph + "：" + (e.message || e));
  }
}

try { tts.close(); } catch (e) {}
const all = fs.readdirSync(OUT_DIR).filter(f => /^\d+\.mp3$/.test(f));
const total = all.reduce((a, f) => a + fs.statSync(path.join(OUT_DIR, f)).size, 0);
console.log("\n完成：本次 " + done + " 条，失败 " + failed + " 条；assets/read 现在 " +
  all.length + " 个文件、" + (total / 1024 / 1024).toFixed(1) + " MB");
if (failed) process.exitCode = 1;
