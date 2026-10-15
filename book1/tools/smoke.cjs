/* 端到端冒烟测试：把构建好的 HTML 在 jsdom 里真跑一遍
   注意：jsdom 是异步解析的，必须等 load 事件后才能查 DOM；
   且 jsdom 不做真实排版计算，页边按钮的「位置」测不了，只能测结构。 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const file = path.join(__dirname, "..", "PET精读-Digging into the past.html");
const html = fs.readFileSync(file, "utf8");

const vc = new VirtualConsole();
vc.on("jsdomError", e => console.log("[jsdomError] " + (e.detail ? (e.detail.stack || e.detail) : e.message)));
vc.on("error", (...a) => console.log("[error] " + a.join(" ")));

// 可控的假 fetch：jsdom 没有 fetch，而「发送到邮箱」整条链都靠它。
// mode 先设成 off，模拟 file:// 打开（请求失败）→ 按钮应保持禁用；
// 测试中途翻成 on 并触发 focus，页面会重新探测 → 按钮启用。
const mailStub = { mode: "off", captured: null };
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = require("util").TextEncoder;
}

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://localhost/",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.TextEncoder = globalThis.TextEncoder;
    w.fetch = function (url, opt) {
      if (mailStub.mode !== "on") return Promise.reject(new TypeError("Failed to fetch"));
      if (/health/.test(url)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, to: "a***@qq.com" }) });
      }
      if (/send/.test(url)) {
        mailStub.captured = JSON.parse(opt.body);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, messageId: "test-id" }) });
      }
      return Promise.reject(new Error("意外的 URL: " + url));
    };
  }
});

let pass = 0, fail = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => { c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m)); };
const click = (el, window) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

async function run() {
  const { window } = dom;
  const doc = window.document;
  const CONTENT = window.PET_CONTENT;

  const passage = doc.getElementById("passage");
  const ana = doc.getElementById("analysis");
  const hist = doc.getElementById("history");
  const qList = doc.getElementById("qList");
  const cols = doc.querySelector(".cols");
  const gutter = doc.getElementById("pgutter");

  console.log("=== 1. 首屏渲染 ===");
  ok(passage.querySelectorAll(".w").length > 250,
    "单词 span " + passage.querySelectorAll(".w").length + " 个");
  ok(passage.querySelectorAll(".ph").length > 20,
    "词组黄标 " + passage.querySelectorAll(".ph").length + " 处");
  ok(passage.querySelectorAll(".sent").length === 22,
    "句子 " + passage.querySelectorAll(".sent").length + " 个");
  ok(passage.querySelectorAll(".blank").length === 5, "空位 5 个");
  ok(!passage.querySelector(".trb"), "没有行内「译」按钮了（翻译已移入分析面板）");
  ok(!passage.querySelector(".tr"), "没有行内译文块");

  console.log("\n--- 句子连续排版 + 交替底色 ---");
  const sents = [...passage.querySelectorAll(".sent")];
  const altCount = sents.filter(s => s.classList.contains("alt")).length;
  ok(altCount === 11, "22 句里 " + altCount + " 句带交替底色（隔一句一个）");
  ok(sents[0].classList.contains("alt") && !sents[1].classList.contains("alt"),
    "第 1 句有底色、第 2 句没有");
  ok(sents[2].classList.contains("alt"), "第 3 句又有底色（循环）");

  console.log("\n--- 页边按钮栏 ---");
  ok(!!gutter, "有页边容器 .pgutter");
  const groups = [...gutter.querySelectorAll(".sbtns")];
  ok(groups.length === 22, "页边按钮组 " + groups.length + " 组（每句一组）");
  ok(groups.every(g => /^\d+-\d+$/.test(g.dataset.for)), "每组都标了归属句子");
  ok(groups[0].querySelector("[data-say]") && groups[0].querySelector(".mini"),
    "每组含 分析 与 🔊 两个按钮");
  ok(groups.filter(g => g.querySelector("[data-say]")).length === 22, "22 个朗读按钮");
  ok(!passage.querySelector(".sent .mini"), "按钮不在句子内部（不会打断连续排版）");

  console.log("\n=== 2. 渲染有没有丢字（逐字对比源数据）===");
  const norm = s => s.replace(/\s+/g, " ").trim();
  const lost = [];
  CONTENT.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => {
    const el = passage.querySelector('[data-sent="' + pi + "-" + si + '"] .sent-txt');
    if (!el) { lost.push(pi + "-" + si + " 缺元素"); return; }
    const want = norm(s.s.replace(/\{(\d+)\}/g, "$1"));
    const got = norm(el.textContent);
    if (want !== got) lost.push(pi + "-" + si + "\n        期望: " + want.slice(0, 90) + "\n        实际: " + got.slice(0, 90));
  }));
  ok(lost.length === 0, "全部 22 句与源数据逐字一致");
  lost.slice(0, 3).forEach(l => console.log("      ✗ " + l));

  console.log("\n=== 3. 点单词 → 分析面板 + 历史 ===");
  click(passage.querySelector('.w[data-w="opportunity"]'), window);
  ok(/词条/.test(ana.textContent), "分析面板显示词条");
  ok(/opportunity/.test(ana.querySelector(".ana-sent").textContent), "词形正确");
  ok(/ˌɒpəˈtjuːnəti/.test(ana.textContent), "音标正确");
  ok(/机会/.test(ana.textContent), "中文释义正确");
  ok(!!ana.querySelector(".ana-spk[data-sayraw]"), "面板顶部有发音喇叭");
  ok(hist.querySelectorAll(".hitem").length === 1, "历史加了 1 行");
  const h0 = hist.querySelector(".hitem");
  ok(h0.classList.contains("w"), "这一行标为「词」");
  ok(h0.querySelector(".hbadge").textContent === "词", "圆圈徽标是「词」");
  ok(h0.querySelector(".hlabel").textContent === "opportunity", "历史里只显示单词本身");

  console.log("\n=== 4. 屈折形式回退查词 ===");
  click(passage.querySelector('.w[data-w="found"]'), window);
  ok(/发现/.test(ana.textContent), "found 回退到 find 的释义：发现");
  ok(hist.querySelector(".hlabel").textContent === "found", "历史里记的是原词形 found");

  console.log("\n=== 5. 词组里的单词仍可单独点 ===");
  const inPhrase = passage.querySelector('.ph .w[data-w="up"]');
  click(inPhrase, window);
  ok(/词条/.test(ana.textContent) && /^up/.test(ana.querySelector(".ana-sent").textContent.trim()),
    "点到的是单词 up 而不是整个词组");
  ok(!!ana.querySelector("[data-word]"), "词条里给出「包含它的词组」入口");
  click(ana.querySelector("[data-word]"), window);
  ok(/dig up/.test(ana.querySelector(".ana-sent").textContent), "通过入口进到词组 dig up");

  console.log("\n=== 6. 点句子 → 分析面板 ===");
  const s00 = passage.querySelector('.sent[data-sent="0-0"]');
  click(s00, window);
  ok(/句子分析/.test(ana.textContent), "分析面板显示句子讲解");
  ok(!!ana.querySelector(".ana-spk[data-say]"), "面板顶部有句子朗读按钮");
  ok(ana.querySelectorAll(".part").length > 0,
    "成分拆解卡片 " + ana.querySelectorAll(".part").length + " 张");
  ok(ana.querySelectorAll(".part .pname").length === ana.querySelectorAll(".part").length,
    "每张卡片都有成分名");
  const shades = [...ana.querySelectorAll(".part")].map(p => p.style.background);
  ok(new Set(shades).size === shades.length, "卡片底色互不相同（依次加深）");
  ok(/翻译/.test(ana.textContent), "有翻译板块");
  ok(s00.classList.contains("cur"), "该句高亮");
  ok(gutter.querySelector('.sbtns[data-for="0-0"]').classList.contains("cur"),
    "页边对应那组按钮也高亮");

  console.log("\n=== 7. 每一句都能点讲（不只长难句）===");
  const easy = passage.querySelector('.sent[data-sent="0-1"]');
  ok(!easy.classList.contains("hard"), "0-1 是普通句");
  click(easy, window);
  ok(/句子分析/.test(ana.textContent), "普通句也出讲解");
  ok(ana.querySelectorAll(".part").length > 0, "普通句也有成分拆解卡片");

  console.log("\n=== 8. 句型字段 ===");
  const MAIN_PAT = ["主谓宾", "主系表", "主谓双宾", "主谓", "倒装引语"];
  let n = 0, bad = [];
  CONTENT.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => {
    n++;
    const pat = s.ana && s.ana.pat;
    if (!Array.isArray(pat) || !pat.length || MAIN_PAT.indexOf(pat[0]) < 0) bad.push(pi + "-" + si);
  }));
  ok(n === 22, "共 " + n + " 句");
  ok(bad.length === 0, "22 句的主句型全部在白名单内");
  bad.slice(0, 5).forEach(b => console.log("      ✗ " + b));
  ok(/句型/.test(ana.textContent), "面板有「句型」板块");
  ok(ana.querySelectorAll(".chip.pat").length > 0, "句型 chip 已渲染");
  ok(ana.querySelector(".chip.pat").classList.contains("pat0"), "主句型带 pat0 样式");

  console.log("\n=== 9. 历史列：词 / 句区分与置顶 ===");
  const sLabel = hist.querySelector(".hitem.s .hlabel");
  ok(!!sLabel, "历史里有「句」类型的行");
  const sl = sLabel.textContent;
  ok(/…$/.test(sl), "句子标签以省略号结尾：" + sl);
  ok(sl.replace(" …", "").split(" ").length === 4, "只取前 4 个词");
  ok(hist.querySelector(".hitem.s .hbadge").textContent === "句", "圆圈徽标是「句」");

  // 重复点击置顶
  const firstW = [...hist.querySelectorAll(".hitem.w")].pop();   // 最早那条词
  const oldKey = firstW.querySelector(".hlabel").textContent;
  const total = hist.querySelectorAll(".hitem").length;
  click(passage.querySelector('.w[data-w="' + oldKey + '"]'), window);
  ok(hist.querySelectorAll(".hitem").length === total, "重复点击不新增行");
  ok(hist.querySelector(".hitem .hlabel").textContent === oldKey, "重复点击把它提到最上面");

  console.log("\n=== 10. 历史列：点回去 / 删除 / 持久化 ===");
  const sRow = [...hist.querySelectorAll(".hitem.s")].pop();
  click(sRow.querySelector(".hopen"), window);
  ok(/句子分析/.test(ana.textContent), "点历史里的「句」能重新显示讲解");
  ok(sRow.classList.contains("cur") || hist.querySelector(".hitem.cur"), "该行高亮");

  const cnt0 = hist.querySelectorAll(".hitem").length;
  click(hist.querySelector(".hitem .hdel"), window);
  ok(hist.querySelectorAll(".hitem").length === cnt0 - 1, "删除按钮少一行");
  ok(!!window.localStorage.getItem("pet-hist-book1-v1"), "历史已写入 localStorage");

  console.log("\n=== 11. 切到题目分析页 ===");
  click(doc.querySelector('.tab[data-tab="quiz"]'), window);
  ok(doc.getElementById("passage").hidden, "原文隐藏");
  ok(!qList.hidden, "题目显示");
  ok(qList.querySelectorAll(".qcard").length === 6, "选项池 + 5 道题");
  ok(qList.querySelectorAll(".opt").length === 8, "选项 A–H 共 8 条");
  ok(passage.querySelectorAll(".qmini").length === 0, "原文页不再有题目（已按需求移出）");
  ok(doc.querySelectorAll("[data-q]").length === 5, "带 data-q 的题卡只有 5 个");

  console.log("\n=== 12. 展开题目分析 ===");
  click(qList.querySelector('[data-qbtn="16"]'), window);
  const q16 = qList.querySelector('[data-q="16"]');
  ok(q16.querySelector(".qbody").classList.contains("show"), "解析展开");
  ok(q16.querySelector(".letter").textContent === "D", "答案 = D");
  ok(/为什么选它/.test(q16.textContent), "有解题思路");
  ok(/其他选项为什么不行/.test(q16.textContent), "有干扰项分析");
  ok(/题目分析/.test(ana.textContent), "分析面板同步显示题目解析");

  console.log("\n=== 13. 选项里的词也能点 ===");
  const ow = qList.querySelector('.opt .w[data-w="jewellery"]');
  ok(!!ow, "选项 G 里的 jewellery 存在");
  click(ow, window);
  ok(/ˈdʒuːəlri/.test(ana.textContent), "点选项里的词也进分析面板");
  ok(hist.querySelector(".hlabel").textContent === "jewellery", "也进了历史");

  console.log("\n=== 14. 全局开关 ===");
  click(doc.getElementById("tglQuiz"), window);
  ok(doc.body.classList.contains("quiz"), "做题模式开启");
  click(doc.getElementById("tglQuiz"), window);
  ok(!doc.body.classList.contains("quiz"), "再点关闭");
  ok(!doc.getElementById("tglAllTr"), "「全部翻译」开关已移除（翻译进了分析面板）");

  console.log("\n=== 15. 小黑板列的显隐 ===");
  const colAna = doc.getElementById("colAna");
  const bAna = doc.getElementById("tglAna");
  ok(!cols.classList.contains("hide-ana"), "默认识别小黑板显示");
  ok(cols.firstElementChild === doc.getElementById("col1"), "DOM 首位是原文列");
  click(bAna, window);
  ok(cols.classList.contains("hide-ana"), "收起小黑板 → hide-ana");
  ok(/全屏/.test(doc.getElementById("col1Hint").textContent), "第一列提示已全屏");
  ok(window.getComputedStyle(colAna).display === "none", "小黑板 display:none");
  click(doc.querySelector('[data-collapse="ana"]'), window);
  ok(!cols.classList.contains("hide-ana"), "列头 ✕ 展开小黑板");
  ok(!/全屏/.test(doc.getElementById("col1Hint").textContent), "第一列提示恢复正常");

  console.log("\n=== 15b. 历史浮动面板 ===");
  const fl = doc.getElementById("histFloat");
  const bHist = doc.getElementById("tglVocab");
  ok(!!fl, "有历史浮层节点");
  ok(fl.hidden === true, "默认是收起的（hidden）");
  ok(window.getComputedStyle(fl).display === "none",
    "默认 display=none —— 这条守住 .hist-float[hidden] 那条规则，" +
    "少了它 display:flex 会盖掉浏览器的 [hidden]{display:none}，面板永远关不掉");
  ok(!bHist.classList.contains("on"), "顶栏开关默认未选中");

  click(bHist, window);
  ok(fl.hidden === false, "点顶栏「历史」弹出浮层");
  ok(bHist.classList.contains("on"), "开关变选中");
  click(bHist, window);
  ok(fl.hidden === true, "再点一次收回");

  // 浮层自带的关闭按钮（用户报的 bug 就是这里关不掉）
  click(bHist, window);
  ok(fl.hidden === false, "重新打开");
  click(doc.getElementById("histClose"), window);
  ok(fl.hidden === true, "点浮层自己的 ✕ 能关掉");

  const savedUI = JSON.parse(window.localStorage.getItem("pet-ui-book1-v2") || "null");
  ok(savedUI && savedUI.vocab === false && savedUI.ana === true,
    "状态已落盘（ana=" + (savedUI && savedUI.ana) + " vocab=" + (savedUI && savedUI.vocab) + "）");

  console.log("\n=== 16. 词组自动推导（与正文黄标零漂移）===");
  click(doc.querySelector('.tab[data-tab="read"]'), window);
  let drift = [];
  for (let pi = 0; pi < CONTENT.passage.paragraphs.length; pi++) {
    for (let si = 0; si < CONTENT.passage.paragraphs[pi].length; si++) {
      const el = passage.querySelector('[data-sent="' + pi + "-" + si + '"]');
      click(el, window);
      const fromAna = [...ana.querySelectorAll("[data-word]")].map(b => b.dataset.word).sort();
      const fromTxt = [...el.querySelectorAll(".ph")].map(p => p.dataset.ph).sort();
      if (JSON.stringify(fromAna) !== JSON.stringify(fromTxt)) {
        drift.push(pi + "-" + si + " 分析=" + JSON.stringify(fromAna) + " 正文=" + JSON.stringify(fromTxt));
      }
    }
  }
  ok(drift.length === 0, "22 句逐句比对：推导词组 === 正文黄标词组");
  drift.slice(0, 4).forEach(d => console.log("      ✗ " + d));

  console.log("\n=== 17. 清空历史 ===");
  ok(hist.querySelectorAll(".hitem").length > 0, "清空前有 " + hist.querySelectorAll(".hitem").length + " 行");
  window.confirm = () => true;
  click(doc.getElementById("btnClear"), window);
  ok(hist.querySelectorAll(".hitem").length === 0, "清空后没有行");
  ok(/🕘/.test(hist.textContent), "显示空状态提示");

  console.log("\n=== 18. 原句吸顶 ===");
  click(passage.querySelector('.sent[data-sent="0-0"]'), window);
  const top = ana.querySelector(".ana-top");
  ok(!!top, "原句外面包了 .ana-top");
  ok(!!top.querySelector(".ana-sent"), "原句在吸顶容器内");
  ok(!!top.querySelector(".ana-h"), "标题和喇叭也在吸顶容器内");
  ok(window.getComputedStyle(top).position === "sticky",
    "position=" + window.getComputedStyle(top).position + "（jsdom 级联支持有限，仅供参考）");

  console.log("\n=== 19. 点句型 → 原句里标红对应部分 ===");
  // 全篇回归：58 个句型 chip 一个都不能定位不到，
  // 否则用户点了没反应，功能就是半残的。
  // 注意：这个循环会把分析面板重渲染 22 次，之前抓的 DOM 引用全部作废，
  // 所以必须放在取 patChips 之前。
  let chipTot = 0, chipDead = [];
  for (let pi = 0; pi < CONTENT.passage.paragraphs.length; pi++) {
    for (let si = 0; si < CONTENT.passage.paragraphs[pi].length; si++) {
      click(passage.querySelector('[data-sent="' + pi + "-" + si + '"]'), window);
      ana.querySelectorAll("button.chip.pat").forEach(c => {
        chipTot++;
        if (c.classList.contains("static")) chipDead.push(pi + "-" + si + " 「" + c.dataset.pat + "」");
      });
    }
  }
  ok(chipDead.length === 0,
    "全篇 " + chipTot + " 个句型 chip 全部可定位（点了都有反应）");
  chipDead.slice(0, 6).forEach(d => console.log("      ✗ 定位不到 " + d));

  click(passage.querySelector('.sent[data-sent="0-0"]'), window);
  const patChips = [...ana.querySelectorAll("button.chip.pat")];
  ok(patChips.length > 0, "回到 0-0，句型 chip " + patChips.length + " 个，是可点的 button");
  ok(patChips.every(c => !c.classList.contains("static")), "0-0 这句的句型都能定位到成分");

  const sentBox = ana.querySelector(".ana-sent");
  const rawText = sentBox.textContent;

  const passive = patChips.find(c => c.dataset.pat === "被动语态");
  ok(!!passive, "找到「被动语态」chip");
  click(passive, window);
  let hls = [...ana.querySelectorAll(".ana-sent .hl")];
  ok(hls.length === 1, "标红了 " + hls.length + " 处");
  ok(hls[0].textContent === "was given", "标出的正是 " + hls[0].textContent);
  ok(passive.classList.contains("on"), "该 chip 变成选中态");
  const sheetText = [...doc.querySelectorAll("style")].map(s => s.textContent).join("");
  ok(/@keyframes hlpop/.test(sheetText) && /scale\(1\.1\)/.test(sheetText),
    "样式表里有 hlpop 的 1.1→1.0 缩放关键帧");
  ok(hls[0].classList.contains("reveal"),
    "动画期间挂 .reveal（inline-block，否则 transform 对 inline 无效）");
  ok(sentBox.textContent === rawText, "标红不改变原句文字（只加包裹）");

  // 换一个句型：旧标记要清掉
  const sv = patChips.find(c => c.dataset.pat === "主谓宾");
  click(sv, window);
  hls = [...ana.querySelectorAll(".ana-sent .hl")];
  ok(hls.length === 3, "「主谓宾」标出 3 处（主/谓/宾），实际 " + hls.length);
  ok(hls.map(x => x.textContent).join("|") === "Kate Marshall|was given|a very exciting opportunity",
    "标出的是：" + hls.map(x => x.textContent).join(" / "));
  ok(!passive.classList.contains("on"), "上一个 chip 的选中态已清除");
  ok(sv.classList.contains("on"), "新 chip 变成选中态");

  // 点自己 = 取消
  click(sv, window);
  ok(ana.querySelectorAll(".ana-sent .hl").length === 0, "再点一次清除标记");
  ok(!sv.classList.contains("on"), "选中态也清掉");
  ok(sentBox.textContent === rawText, "清除后原句完好");

  // 切到别的句子，不能残留上一次的标记
  click(passive, window);
  ok(ana.querySelectorAll(".ana-sent .hl").length === 1, "先标上");
  click(passage.querySelector('.sent[data-sent="1-0"]'), window);
  ok(ana.querySelectorAll(".ana-sent .hl").length === 0, "换一句后标记不残留");
  ok(ana.querySelectorAll(".chip.pat.on").length === 0, "chip 选中态也不残留");

  console.log("\n=== 20. 历史里的词条：只留英文 + 中文 ===");
  click(passage.querySelector('.w[data-w="ancient"]'), window);
  const wrow = hist.querySelector(".hitem.w");
  ok(wrow.querySelector(".hlabel").textContent === "ancient", "有英文");
  ok(/古老的/.test(wrow.querySelector(".hcn").textContent),
    "有中文：" + wrow.querySelector(".hcn").textContent);
  ok(!wrow.querySelector(".hipa"), "音标已去掉");
  ok(!wrow.querySelector(".hpos"), "词性已去掉");
  const srow = hist.querySelector(".hitem.s");
  ok(!srow.querySelector(".hcn"), "句行不套用词条的排版");
  ok(/…$/.test(srow.querySelector(".hlabel").textContent), "句行仍是前 4 词 + 省略号");

  console.log("\n=== 21. 顶栏按钮文案与列标题 ===");
  ok(/小黑板/.test(doc.getElementById("tglAna").textContent),
    "顶栏开关已改名：" + doc.getElementById("tglAna").textContent);
  ok(/小黑板/.test(doc.querySelector("#colAna .col-head > span").textContent),
    "第二列标题：" + doc.querySelector("#colAna .col-head > span").textContent);
  ok(/历史/.test(doc.getElementById("tglVocab").textContent),
    "「历史」：" + doc.getElementById("tglVocab").textContent);
  ok(!/分析面板/.test(doc.body.textContent), "页面上不再出现「分析面板」字样");

  console.log("\n=== 22. 页边「析」按钮 ===");
  const anaBtn = gutter.querySelector('.sbtns[data-for="3-1"] [data-ana]');
  ok(!!anaBtn, "「析」按钮带 data-ana（没有它点击会毫无反应）");
  ok(anaBtn.dataset.ana === "3-1", "标的归属正确");
  const sheetTxt = [...doc.querySelectorAll("style")].map(s => s.textContent).join("");
  ok(/\.sent\.peek/.test(sheetTxt), "样式表里有 .sent.peek 粉色高亮规则");

  ana.innerHTML = "";
  click(anaBtn, window);
  ok(/句子分析/.test(ana.textContent), "点「析」弹出该句讲解");
  ok(/as…as|比较/.test(ana.textContent), "内容确实是 3-1 那句（as…as 比较句）");
  ok(passage.querySelector('.sent[data-sent="3-1"]').classList.contains("cur"), "该句高亮");
  ok(hist.querySelector(".hitem .hlabel").textContent.indexOf("However") === 0,
    "也进了历史：" + hist.querySelector(".hitem .hlabel").textContent);

  // 悬停变粉：CSS 规则已在上面验过，这里验证 JS 会挂 / 摘这个类
  anaBtn.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  ok(passage.querySelector('.sent[data-sent="3-1"]').classList.contains("peek"),
    "鼠标停到「析」上，对应句挂 .peek（变粉）");
  anaBtn.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
  ok(!passage.querySelector('.sent[data-sent="3-1"]').classList.contains("peek"),
    "移开恢复原背景");

  console.log("\n=== 23. 原文页 = 文章 + 题目 ===");
  click(doc.querySelector('.tab[data-tab="read"]'), window);
  const qRead = doc.getElementById("qListRead");
  ok(!qRead.hidden, "原文页的题目区可见");
  ok(!passage.hidden, "文章也在（题目加在文章下面）");
  ok(qRead.querySelectorAll(".opt").length === 8, "含 A–H 选项池");
  ok(qRead.querySelectorAll(".qmini").length === 0,
    "原文页不再有 16–20 的题卡（解析改从选项的「答题解析」看）");
  ok(!qRead.querySelector("[data-qbtn]"), "原文页没有题卡「分析」按钮");
  // 每行三个动作
  const acts = qRead.querySelector(".opt .oacts");
  ok(!!acts, "选项行右边有动作区");
  ok(acts.querySelectorAll(".obtn").length === 3, "每行三个按钮");
  ok(/句子分析/.test(acts.querySelector("[data-ana]").textContent), "第一个是「句子分析」");
  ok(!!acts.querySelector("[data-sayraw]"), "第二个是朗读");
  ok(/答题解析/.test(acts.querySelector("[data-qexp]").textContent), "第三个是「答题解析」");
  ok(qRead.querySelectorAll("[data-qexp]").length === 8, "8 条选项都有答题解析按钮");
  // 「→ 第 N 空」等于把答案写在题面上，「干扰项」也在暗示哪个不是答案，两个都不给
  ok(qRead.querySelectorAll(".opt .tag").length === 0, "原文页选项不显示答案标记（不剧透）");
  ok(qList.querySelectorAll(".opt .tag").length === 8,
    "题目分析页仍然显示标记（" + qList.querySelectorAll(".opt .tag").length + " 条）");

  console.log("\n--- 喇叭靠拢「词条」---");
  click(passage.querySelector('.w[data-w="ancient"]'), window);
  const spkBtn = ana.querySelector(".ana-h .ana-spk");
  ok(!!spkBtn, "词条卡片顶部有喇叭");
  ok(window.getComputedStyle(spkBtn).marginLeft !== "auto",
    "喇叭不再被推到右边（margin-left:auto 已去掉），紧跟在「词条」后面");
  ok(spkBtn.textContent.trim() === "🔊", "喇叭按钮上不显示速度字样：" + spkBtn.textContent.trim());

  console.log("\n=== 24. 选项也按句子 / 词 / 词组分析 ===");
  const optA = qRead.querySelector('.opt[data-opt="A"]');
  ok(optA.querySelectorAll(".w").length > 5, "选项里的词可点（" + optA.querySelectorAll(".w").length + " 个）");
  ok(!!optA.querySelector("[data-ana]"), "选项有「句子分析」按钮");
  ok(!!optA.querySelector("[data-sayraw]"), "选项有朗读按钮");
  ok(Object.keys(CONTENT.optionsAna || {}).length === 8, "8 个选项都有分析数据");

  // 选项的句子分析要能被解析出来（anaData 支持 opt: 前缀）
  click(optA.querySelector("[data-ana]"), window);
  ok(/句子分析/.test(ana.textContent), "点选项的「析」出讲解");
  ok(/figure/.test(ana.textContent), "内容是选项 A（figure 的一词多义）");
  ok(ana.querySelectorAll(".part").length > 0, "选项也有成分拆解卡片");
  ok(ana.querySelectorAll("button.chip.pat").length > 0, "选项也有可点句型");
  ok(ana.querySelectorAll("button.chip.pat.static").length === 0, "选项 A 的句型都能定位");
  // 全量：8 个选项的每个句型 chip 都要能定位，跟正文那条卡口一个道理
  let oChipTot = 0, oChipDead = [];
  ["A", "B", "C", "D", "E", "F", "G", "H"].forEach(L => {
    click(qRead.querySelector('.opt[data-opt="' + L + '"] [data-ana]'), window);
    ana.querySelectorAll("button.chip.pat").forEach(c => {
      oChipTot++;
      if (c.classList.contains("static")) oChipDead.push(L + " 「" + c.dataset.pat + "」");
    });
  });
  ok(oChipDead.length === 0, "8 个选项共 " + oChipTot + " 个句型 chip 全部可定位");
  oChipDead.forEach(d => console.log("      ✗ 定位不到 " + d));
  click(optA.querySelector("[data-ana]"), window);
  ok(optA.classList.contains("cur"), "选项整条高亮");
  const oHist = hist.querySelector(".hitem.s .hlabel").textContent;
  ok(/^It turned out/.test(oHist), "选项也以「句」的身份进历史：" + oHist);

  // 词组标黄在选项里也生效
  let optPhrase = 0;
  qRead.querySelectorAll(".opt .ph").forEach(() => optPhrase++);
  ok(optPhrase > 0, "选项里的词组也标黄（" + optPhrase + " 处）");

  console.log("\n=== 25. 点选项整句（不只是「析」按钮）===");
  ana.innerHTML = "";
  const optD = qRead.querySelector('.opt[data-opt="D"]');
  click(optD.querySelector(".otxt"), window);
  ok(/句子分析/.test(ana.textContent), "点选项文字也出讲解");
  ok(/In fact/.test(ana.textContent), "内容是选项 D");

  console.log("\n=== 26. 词条判空 ===");
  ana.innerHTML = '<div class="ana">占位</div>';
  const before = ana.textContent;
  // 直接调内部接口不现实，这里模拟：点正文里非单词区域（段落空白）
  click(passage.querySelector(".para"), window);
  ok(ana.textContent === before, "点到非单词区域不改变面板（不会渲染空白卡片）");
  // 全量扫描：每个可点元素都得产出有内容的词条/讲解，不许出空卡片
  let scanned = 0, blanks = [];
  const probe = el => {
    scanned++;
    click(el, window);
    const t = ana.textContent.replace(/\s+/g, " ").trim();
    if (!ana.querySelector(".ana-sent") || t.length < 12) blanks.push((el.dataset.w || el.dataset.ph || "?") + " → «" + t.slice(0, 40) + "»");
  };
  passage.querySelectorAll(".w").forEach(probe);
  passage.querySelectorAll(".ph").forEach(probe);
  qRead.querySelectorAll(".w").forEach(probe);
  ok(blanks.length === 0, "扫描 " + scanned + " 个可点元素，没有空词条");
  blanks.slice(0, 5).forEach(b => console.log("      ✗ 空面板 " + b));

  console.log("\n=== 27. 答题解析 ===");
  click(doc.querySelector('.tab[data-tab="read"]'), window);
  const qr = doc.getElementById("qListRead");

  // A 是第 20 题的答案
  click(qr.querySelector('.opt[data-opt="A"] [data-qexp]'), window);
  ok(/答题解析 · 选项 A/.test(ana.textContent), "小黑板显示答题解析");
  ok(/它是第 20 题的答案/.test(ana.textContent), "指出 A 是第 20 题的答案");
  ok(/为什么|因为|指代|figure/.test(ana.textContent), "带上了该题的解题思路");
  ok(/线索词/.test(ana.textContent), "有线索词板块");
  ok(/做题方法/.test(ana.textContent), "有做题方法");

  // B 是干扰项，且在多题里被提及
  click(qr.querySelector('.opt[data-opt="B"] [data-qexp]'), window);
  ok(/它不填任何空/.test(ana.textContent), "指出 B 不填任何空");
  ok(/干扰项/.test(ana.textContent), "明确标为干扰项");
  ok(/第 1[6-9] 题|第 20 题/.test(ana.textContent), "列出它在哪些题里被当成干扰项");

  console.log("\n--- 答题解析不进历史 ---");
  // 先把历史清空，否则前面几轮测试已经把 8 个选项都点进去了，
  // 行数不变说明不了任何问题（去重后只是置顶）
  window.confirm = () => true;
  click(doc.getElementById("btnClear"), window);
  ok(hist.querySelectorAll(".hitem").length === 0, "历史已清空，从零开始验");

  click(qr.querySelector('.opt[data-opt="C"] [data-qexp]'), window);
  ok(/答题解析/.test(ana.textContent), "答题解析已渲染");
  ok(hist.querySelectorAll(".hitem").length === 0, "点答题解析不产生历史行");
  ok(hist.querySelectorAll(".hitem.cur").length === 0, "也不高亮任何历史行");

  console.log("\n--- 但句子分析仍然进历史 ---");
  click(qr.querySelector('.opt[data-opt="C"] [data-ana]'), window);
  ok(hist.querySelectorAll(".hitem").length === 1,
    "句子分析照常记一行（0 → " + hist.querySelectorAll(".hitem").length + "）");
  ok(hist.querySelector(".hitem").classList.contains("s"), "记的是「句」类型");

  console.log("\n=== 28. 两列各占一半 ===");
  const css = [...doc.querySelectorAll("style")].map(s => s.textContent).join("");
  // 注意：.cols 里 display:grid 和 grid-template-columns 之间夹着注释，正则不能写死成相邻
  const m = css.match(/grid-template-columns:minmax\(0,([\d.]+)fr\)\s*minmax\(0,([\d.]+)fr\);[\s\S]{0,200}?hide-ana/);
  ok(!!m, "找到两列网格定义");
  if (m) {
    ok(+m[1] === 1 && +m[2] === 1, "原文 : 小黑板 = " + m[1] + " : " + m[2] + "（各占一半）");
  }
  ok(!/grid-template-columns:[^;]*1\.66fr/.test(css), "旧的 1.66/1.33/.86 三列定义已移除");
  ok(doc.querySelector("#histFloat").parentElement === doc.body,
    "历史浮层不在 .cols 网格里（挪出去才腾得出空间给两列各半）");

  console.log("\n=== 29. 字号缩放滑动条 ===");
  const zr = doc.getElementById("zoomRange");
  const zlab = doc.getElementById("zoomLabel");
  ok(!!zr && !!zlab, "顶栏有滑动条和读数");
  ok(zr.min === "1" && zr.max === "5", "范围 1x–5x");
  ok(zr.value === "1", "默认 1x");
  ok(window.getComputedStyle(doc.documentElement).getPropertyValue("--zoom").trim() === "1",
    "--zoom 初始为 1");

  zr.value = "3";
  zr.dispatchEvent(new window.Event("input", { bubbles: true }));
  const rootStyle = doc.documentElement.style.getPropertyValue("--zoom");
  ok(rootStyle === "3", "拖到 3x 后 --zoom=" + rootStyle);
  ok(/3x/.test(zlab.textContent), "读数变成 " + zlab.textContent);
  ok(window.localStorage.getItem("pet-zoom-book1-v1") === "3", "缩放值已落盘");

  // 缩回 1x：这是用户报的 bug 场景（放大再缩小后页边按钮错位）
  zr.value = "1";
  zr.dispatchEvent(new window.Event("input", { bubbles: true }));
  ok(doc.documentElement.style.getPropertyValue("--zoom") === "1", "缩回 1x");

  // 页边按钮的定位逻辑要真跑起来才算验到。
  // jsdom 不做排版、所有 rect 都是 0，layoutGutter 会直接早退，
  // 所以这里造一组假的 rect：每句比上一句低 30px，正文容器高 1000px。
  const realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === "passage") {
      return { top: 0, height: 1000, bottom: 1000, left: 0, right: 800, width: 800, x: 0, y: 0 };
    }
    if (this.classList && this.classList.contains("sent")) {
      const p = this.dataset.sent.split("-");
      const n = CONTENT.passage.paragraphs.slice(0, +p[0]).reduce((a, q) => a + q.length, 0) + (+p[1]);
      return { top: n * 30, height: 20, bottom: n * 30 + 20, left: 0, right: 0, width: 0, x: 0, y: 0 };
    }
    return realRect.call(this);
  };

  // 触发一次重算（applyZoom 内部会调 layoutGutter）
  zr.value = "2";
  zr.dispatchEvent(new window.Event("input", { bubbles: true }));
  zr.value = "1";
  zr.dispatchEvent(new window.Event("input", { bubbles: true }));

  const tops = [...gutter.querySelectorAll(".sbtns")]
    .map(g => parseFloat(g.style.top)).filter(v => !isNaN(v));
  ok(tops.length === 22, "缩放来回后，22 组页边按钮都拿到了 top（实际 " + tops.length + "）");
  ok(tops[0] === 0 && tops[1] === 30,
    "位置跟着句子走：第 1 组 top=" + tops[0] + "，第 2 组 top=" + tops[1]);
  let mono = true;
  for (let i = 1; i < tops.length; i++) if (tops[i] < tops[i - 1]) mono = false;
  ok(mono, "top 单调递增，放大再缩小后不会上下错乱");
  let gapOK = true;
  for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] < 2) gapOK = false;
  ok(gapOK, "相邻按钮至少隔 2px，没有叠在一起");

  // 重叠时后一组要往下让位：把所有句子压到同一行，看第二组是否被推开
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === "passage") {
      return { top: 0, height: 1000, bottom: 1000, left: 0, right: 800, width: 800, x: 0, y: 0 };
    }
    if (this.classList && this.classList.contains("sent")) {
      return { top: 0, height: 20, bottom: 20, left: 0, right: 0, width: 0, x: 0, y: 0 };
    }
    return realRect.call(this);
  };
  zr.value = "1.5";
  zr.dispatchEvent(new window.Event("input", { bubbles: true }));
  const flat = [...gutter.querySelectorAll(".sbtns")].map(g => parseFloat(g.style.top));
  ok(flat[1] > flat[0], "句子都在同一行时，后一组自动下移让位（" + flat[0] + " → " + flat[1] + "）");

  window.Element.prototype.getBoundingClientRect = realRect;   // 还原，别影响后面的断言

  // 缩放只作用于两栏：历史浮层不能跟着变大
  ok(/\.hist-float\{[^}]*font-size:calc\([^)]*var\(--zoom\)/.test(css) === false,
    "历史浮层里没有 calc(...var(--zoom))");
  ok(/#col1\{font-size:calc\(17px \* var\(--zoom\)\)\}/.test(css), "原文列基准字号随缩放走（17px 起）");
  ok(/#colAna\{font-size:calc\(16px \* var\(--zoom\)\)\}/.test(css), "小黑板基准字号随缩放走（16px 起）");
  ok(/\.mini\{[^}]*width:calc\(24px \* var\(--zoom\)\)/.test(css), "页边「析」按钮尺寸一起缩放");
  ok(/#passage\{position:relative;padding-right:calc\(58px \* var\(--zoom\)\)\}/.test(css),
    "页边宽度一起缩放，放大后按钮才放得进");

  console.log("\n=== 30. 发送到邮箱 ===");
  const btnMail = doc.getElementById("btnMail");
  const mailMsgEl = doc.getElementById("mailMsg");
  ok(!!btnMail, "顶栏有发送按钮");
  ok(!!mailMsgEl, "有状态提示区");

  // 此时 fetch 是 reject 的（模拟 file:// 打开），按钮必须保持禁用
  await sleep(20);
  ok(btnMail.disabled === true, "探测失败时按钮禁用（本地双击打开就是这种情况）");

  // 服务起来之后再探一次：把 stub 翻成可用，触发 focus
  mailStub.mode = "on";
  window.dispatchEvent(new window.Event("focus"));
  await sleep(30);
  ok(btnMail.disabled === false, "探测到服务后按钮启用");
  ok(/a\*\*\*@qq\.com/.test(btnMail.title), "按钮提示里带上收件人：" + btnMail.title);

  // 备一点历史：一个单词、一个词组、一句话
  click(passage.querySelector('.w[data-w="ancient"]'), window);
  click(passage.querySelector('.ph'), window);
  click(passage.querySelector('.sent[data-sent="0-0"]'), window);
  const nHist = hist.querySelectorAll(".hitem").length;
  ok(nHist >= 3, "历史里有 " + nHist + " 条，够导出了");

  click(btnMail, window);
  await sleep(60);
  ok(!!mailStub.captured, "点发送后向服务端 POST 了内容");

  const cap = mailStub.captured || {};
  ok(/PET 精读/.test(cap.subject || ""), "邮件主题：" + cap.subject);
  ok(/词/.test(cap.subject || "") && /句/.test(cap.subject || ""), "主题里带统计数字");
  ok(/\.doc$/.test(cap.filename || ""), "附件名是 .doc：" + cap.filename);
  ok(typeof cap.content === "string" && cap.content.length > 100, "附件内容是 base64 字符串");

  // 解码附件，检查 Word 文档内容和中文有没有乱码
  const decoded = Buffer.from(cap.content || "", "base64").toString("utf8");
  ok(/xmlns:w="urn:schemas-microsoft-com:office:word"/.test(decoded),
    "是 Word 能打开的格式（带 Word 命名空间）");
  ok(/<h1>PET 精读/.test(decoded), "标题正确");
  ok(/一、单词/.test(decoded), "有「单词」分节");
  ok(/二、词组/.test(decoded), "有「词组」分节");
  ok(/三、句子/.test(decoded), "有「句子」分节");
  ok(/ancient/.test(decoded) && /古代的/.test(decoded),
    "单词条目含词形和中文释义，中文没乱码");
  ok(/\/ˈeɪnʃənt\//.test(decoded), "含英式音标");
  ok(/翻译：/.test(decoded), "句子带翻译");
  ok(/句型：/.test(decoded), "句子带句型");
  ok(!/<script/i.test(decoded), "导出内容里没有脚本（不会被当成脚本执行）");

  // 正文里有一份纯文本摘要
  ok(/ancient/.test(cap.body || "") && /来自 PET 精读页/.test(cap.body || ""),
    "邮件正文含纯文本摘要");

  ok(/已发送/.test(mailMsgEl.textContent), "界面上给了成功提示：" + mailMsgEl.textContent.trim());
  ok(btnMail.disabled === false, "发送完成后按钮重新可用（能再发一次）");

  console.log("\n--- 发送失败的提示 ---");
  const realFetch = window.fetch;
  window.fetch = function (url, opt) {
    if (/health/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, to: "a***@qq.com" }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "邮箱认证失败（测试用）" }) });
  };
  click(btnMail, window);
  await sleep(40);
  ok(/发送失败/.test(mailMsgEl.textContent) && /认证失败/.test(mailMsgEl.textContent),
    "服务端报错会显示到界面上：" + mailMsgEl.textContent.trim());
  ok(btnMail.disabled === false, "失败后按钮也恢复可用，能重试");
  window.fetch = realFetch;

  console.log("\n" + (fail === 0 ? "★ 全部通过" : "★ " + fail + " 项失败") +
    "  ——  通过 " + pass + " / 失败 " + fail);
  process.exit(fail === 0 ? 0 : 1);
}

dom.window.addEventListener("load", () => setTimeout(run, 50));
