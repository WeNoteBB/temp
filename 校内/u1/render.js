const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createCanvas, DOMMatrix, Path2D, ImageData } = require("@napi-rs/canvas");
globalThis.DOMMatrix = DOMMatrix;
globalThis.Path2D = Path2D;
globalThis.ImageData = ImageData;

(async () => {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).href;

  const src = "C:\\Users\\89300\\Desktop\\校内\\六上英语笔记\\六上英语笔记_1-9.pdf";
  const outDir = "C:\\Users\\89300\\Desktop\\pet\\校内\\u1\\pages";
  fs.mkdirSync(outDir, { recursive: true });

  const data = new Uint8Array(fs.readFileSync(src));
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: true, isEvalSupported: false }).promise;
  const scale = 2.0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.floor(vp.width), Math.floor(vp.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    fs.writeFileSync(path.join(outDir, `page${String(p).padStart(2,"0")}.png`), canvas.toBuffer("image/png"));
    console.log("page", p, Math.floor(vp.width)+"x"+Math.floor(vp.height));
    page.cleanup();
  }
  console.log("DONE");
})().catch(e => { console.error("ERR:", e && e.stack || e); process.exit(1); });
