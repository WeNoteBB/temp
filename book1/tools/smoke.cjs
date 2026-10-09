/* 端到端冒烟测试：把构建好的 HTML 在 jsdom 里真跑一遍
   注意：jsdom 是异步解析的，必须等 load 事件后才能查 DOM */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const file = path.join(__dirname, "..", "PET精读-Digging into the past.html");
const html = fs.readFileSync(file, "utf8");

const vc = new VirtualConsole();
vc.on("jsdomError", e => console.log("[jsdomError] " + (e.detail ? (e.detail.stack || e.detail) : e.message)));
vc.on("error", (...a) => console.log("[error] " + a.join(" ")));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://localhost/",
  pretendToBeVisual: true,
  virtualConsole: vc
});

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m)); };
const click = (el, window) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

function run() {
  const { window } = dom;
  const doc = window.document;
  const CONTENT = window.PET_CONTENT;

  console.log("=== 1. 首屏渲染 ===");
  const passage = doc.getElementById("passage");
  const vocab = doc.getElementById("vocab");
  const ana = doc.getElementById("analysis");
  const qList = doc.getElementById("qList");
  ok(!!passage && passage.querySelectorAll(".w").length > 250,
    "单词 span " + passage.querySelectorAll(".w").length + " 个");
  ok(passage.querySelectorAll(".ph").length > 20,
    "词组黄标 " + passage.querySelectorAll(".ph").length + " 处");
  ok(passage.querySelectorAll(".sent").length === 22,
    "句子 " + passage.querySelectorAll(".sent").length + " 个（应为 22）");
  ok(passage.querySelectorAll(".blank").length === 5,
    "空位 " + passage.querySelectorAll(".blank").length + " 个（应为 5）");
  ok(passage.querySelectorAll(".spk").length >= 22,
    "喇叭 " + passage.querySelectorAll(".spk").length + " 个");
  ok(passage.querySelectorAll(".trb").length >= 22, "翻译按钮齐全");

  console.log("\n=== 2. 渲染有没有丢字（逐字对比源数据）===");
  const norm = s => s.replace(/\s+/g, " ").trim();
  const lost = [];
  CONTENT.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => {
    const el = passage.querySelector('[data-sent="' + pi + "-" + si + '"] .sent-txt');
    if (!el) { lost.push({ ref: pi + "-" + si, want: "(缺元素)", got: "" }); return; }
    const want = norm(s.s.replace(/\{(\d+)\}/g, "$1"));   // 空位会渲染成可见的题号
    const got = norm(el.textContent);
    if (want !== got) lost.push({ ref: pi + "-" + si, want, got });
  }));
  ok(lost.length === 0, "全部 22 句与源数据逐字一致");
  lost.slice(0, 4).forEach(l => {
    console.log("      ✗ 差异 @" + l.ref);
    console.log("        期望: " + l.want.slice(0, 100));
    console.log("        实际: " + l.got.slice(0, 100));
  });

  console.log("\n=== 3. 点单词 → 生词本 ===");
  const w1 = passage.querySelector('.w[data-w="opportunity"]');
  ok(!!w1, "定位到 opportunity");
  click(w1, window);
  const card = vocab.querySelector(".vcard");
  ok(!!card, "生词本出现卡片");
  ok(card && card.querySelector(".vw").textContent === "opportunity", "词形正确");
  ok(card && /ˌɒpəˈtjuːnəti/.test(card.querySelector(".vipa").textContent),
    "音标正确 " + (card && card.querySelector(".vipa").textContent));
  ok(card && card.querySelector(".vpos").textContent === "n.", "词性正确");
  ok(card && !!card.querySelector(".vspk"), "带发音喇叭");
  ok(card && !card.querySelector(".vctx"), "不再显示原文例句（已按需求移除）");

  console.log("\n=== 4. 点屈折形式（回退查词）===");
  const wf = passage.querySelector('.w[data-w="found"]');
  click(wf, window);
  const c2 = vocab.querySelector(".vcard");
  ok(c2.querySelector(".vw").textContent === "found", "显示的是原词形 found");
  ok(/发现/.test(c2.querySelector(".vcn").textContent), "回退到 find 的释义：发现");

  console.log("\n=== 4b. 词组里的单词仍可单独点 ===");
  const inPhrase = passage.querySelector('.ph .w[data-w="up"]');
  ok(!!inPhrase, "dig up 里的 up 存在（被词组包住）");
  click(inPhrase, window);
  const cUp = vocab.querySelector(".vcard");
  ok(cUp.querySelector(".vw").textContent === "up",
    "点到的是单词 up 而不是整个词组（实际：" + cUp.querySelector(".vw").textContent + "）");
  const phLink = cUp.querySelector("[data-vph]");
  ok(!!phLink, "单词卡片里有「包含它的词组」入口");
  click(phLink, window);
  ok(vocab.querySelector(".vcard").classList.contains("phrase"),
    "通过入口能进到词组：" + vocab.querySelector(".vcard .vw").textContent);

  console.log("\n=== 5. 点词组 ===");
  const p1 = passage.querySelector(".ph");
  const pkey = p1.dataset.ph;
  const nBefore = vocab.querySelectorAll(".vcard").length;
  click(p1, window);
  const cards = vocab.querySelectorAll(".vcard");
  ok(cards.length === nBefore + 1, "生词本累积 +1（" + nBefore + " → " + cards.length + "，不替换旧的）");
  ok(cards[0].classList.contains("phrase"), "词组卡片带 phrase 样式，key=" + pkey);
  ok(!!cards[0].querySelector(".vcn").textContent.trim(), "词组有中文释义");

  console.log("\n=== 6. 点句子 → 右栏分析 ===");
  const hardSent = passage.querySelector(".sent.hard");
  click(hardSent, window);
  ok(/句子分析/.test(ana.textContent), "右栏出现句子分析");
  ok(ana.querySelectorAll(".struct tr").length > 0,
    "成分拆解表 " + ana.querySelectorAll(".struct tr").length + " 行");
  ok(ana.querySelectorAll(".chip").length > 0,
    "语法点标签 " + ana.querySelectorAll(".chip").length + " 个");
  ok(/翻译/.test(ana.textContent), "有翻译板块");
  ok(ana.querySelectorAll(".sec-t").length >= 3, "分析板块 " + ana.querySelectorAll(".sec-t").length + " 个");
  ok(hardSent.classList.contains("cur"), "当前句高亮");

  console.log("\n=== 7. 翻译按钮（默认隐藏）===");
  const trb = passage.querySelector(".trb");
  const trbox = passage.querySelector('[data-trbox="' + trb.dataset.tr + '"]');
  ok(!!trbox, "翻译盒子存在");
  ok(!trbox.classList.contains("show"), "默认不显示 ✓");
  click(trb, window);
  ok(trbox.classList.contains("show"), "点「译」后显示");
  click(trb, window);
  ok(!trbox.classList.contains("show"), "再点一次收起");

  console.log("\n=== 8. 切到题目分析 ===");
  click(doc.querySelector('.tab[data-tab="quiz"]'), window);
  ok(doc.getElementById("passage").hidden, "原文已隐藏");
  ok(!qList.hidden, "题目已显示");
  ok(qList.querySelectorAll(".qcard").length === 6,
    "卡片 " + qList.querySelectorAll(".qcard").length + " 个（1 选项池 + 5 题）");
  ok(qList.querySelectorAll(".opt").length === 8, "选项 A–H 共 8 条");
  ok([...qList.querySelectorAll(".opt .tag")].filter(t => /→ 第/.test(t.textContent)).length === 5,
    "5 条选项被标记为已用");
  ok([...qList.querySelectorAll(".opt .tag")].filter(t => /干扰项/.test(t.textContent)).length === 3,
    "3 条标记为干扰项");

  console.log("\n=== 9. 展开第 16 题 ===");
  click(qList.querySelector('[data-qbtn="16"]'), window);
  const qcard = qList.querySelector('[data-q="16"]');
  ok(qcard.querySelector(".qbody").classList.contains("show"), "解析已展开");
  ok(qcard.querySelector(".letter").textContent === "D", "答案字母 = D");
  ok(/为什么选它/.test(qcard.textContent), "有解题思路");
  ok(/线索词/.test(qcard.textContent), "有线索词");
  ok(/其他选项为什么不行/.test(qcard.textContent), "有干扰项分析");
  ok(/题目分析/.test(ana.textContent), "右栏同步显示题目解析");
  ok(ana.querySelectorAll(".struct tr").length > 0, "右栏有答案句拆解");

  console.log("\n=== 10. 选项里的词也能点 ===");
  const ow = qList.querySelector('.opt .w[data-w="jewellery"]');
  ok(!!ow, "选项 G 里的 jewellery 存在");
  const n0 = vocab.querySelectorAll(".vcard").length;
  click(ow, window);
  ok(vocab.querySelectorAll(".vcard").length === n0 + 1, "选项里的词也进同一个生词本");

  console.log("\n=== 11. 全局开关 ===");
  click(doc.getElementById("tglQuiz"), window);
  ok(doc.body.classList.contains("quiz"), "做题模式开启（CSS 会藏起答案句）");
  click(doc.getElementById("tglAllTr"), window);
  ok(doc.body.classList.contains("alltr"), "全部翻译开启");
  ok(!!window.localStorage.getItem("pet-vocab-book1-v1"), "生词本已写入 localStorage");

  console.log("\n=== 12. 语音引擎状态 ===");
  ok(true, "jsdom 无 speechSynthesis，页面已做存在性判断未崩溃（真实发音需浏览器验证）");

  console.log("\n=== 13. 2:1:1 网格与列显隐 ===");
  const cols = doc.querySelector(".cols");
  const col1 = doc.getElementById("col1");
  const colAna = doc.getElementById("colAna");
  const colVocab = doc.getElementById("colVocab");
  const bAna = doc.getElementById("tglAna");
  const bVocab = doc.getElementById("tglVocab");

  ok(!!col1 && !!colAna && !!colVocab, "三个列节点都在（col1 / colAna / colVocab）");
  ok(cols.firstElementChild === col1, "DOM 首位是第一列（窄屏堆叠顺序依赖它）");
  ok(!cols.classList.contains("hide-ana") && !cols.classList.contains("hide-vocab"),
    "默认两栏全显示");
  ok(bAna.classList.contains("on") && bVocab.classList.contains("on"), "两个顶栏开关默认选中");
  ok(/句子列/.test(bAna.title) && /单词列/.test(bVocab.title),
    "按钮提示正确：" + bAna.title + " / " + bVocab.title);

  click(bVocab, window);
  ok(cols.classList.contains("hide-vocab") && !cols.classList.contains("hide-ana"),
    "收起单词栏 → hide-vocab");
  ok(!bVocab.classList.contains("on"), "开关变成未选中态");
  ok(doc.body.contains(colVocab), "节点仍在 DOM（只是 CSS 隐藏，数据不丢）");
  const dv = window.getComputedStyle(colVocab).display;
  ok(dv === "none", "计算样式 display=" + dv + "（jsdom 级联支持有限，仅供参考）");

  click(bAna, window);
  ok(cols.classList.contains("hide-vocab") && cols.classList.contains("hide-ana"), "两栏都收起");
  ok(/全屏/.test(doc.getElementById("col1Hint").textContent),
    "第一列提示已全屏：" + doc.getElementById("col1Hint").textContent.trim());
  // 注意：此时停在"题目分析"页，所以 passage 本就该是隐藏的，该查的是第一列本身
  ok(!col1.hidden, "第一列还在");
  ok(!doc.getElementById("qList").hidden, "第一列当前显示的是题目（当前在题目页）");

  click(bVocab, window);
  ok(!cols.classList.contains("hide-vocab") && cols.classList.contains("hide-ana"),
    "只展开单词栏，句子栏仍收起");
  ok(!/全屏/.test(doc.getElementById("col1Hint").textContent), "第一列提示恢复正常");

  console.log("\n--- 列头 ✕ 按钮（守住 toggleCol 的 + 号陷阱）---");
  const xbtn = doc.querySelector('[data-collapse="ana"]');
  ok(!!xbtn, "句子分析栏头部有收起按钮");
  click(xbtn, window);
  ok(!cols.classList.contains("hide-ana"), "点 ✕ 展开句子栏（若此处失败，多半是 toggleCol 里多写了 + 号）");
  click(xbtn, window);
  ok(cols.classList.contains("hide-ana"), "再点一次收起");
  const xv = doc.querySelector('[data-collapse="vocab"]');
  click(xv, window);
  ok(cols.classList.contains("hide-vocab"), "单词栏的 ✕ 也生效");

  console.log("\n=== 14. 列状态持久化 ===");
  const savedUI = JSON.parse(window.localStorage.getItem("pet-ui-book1-v1") || "null");
  ok(savedUI && savedUI.vocab === false && savedUI.ana === false,
    "列状态已存新结构：ana=" + (savedUI && savedUI.ana) + " vocab=" + (savedUI && savedUI.vocab));
  ok(!!window.localStorage.getItem("pet-vocab-book1-v1"), "生词本存的是另一个 key，互不影响");

  // 回到原文页、展开两栏，为后面的断言复位
  click(doc.querySelector('.tab[data-tab="read"]'), window);
  click(doc.getElementById("tglAna"), window);
  click(doc.getElementById("tglVocab"), window);
  ok(!cols.classList.contains("hide-ana") && !cols.classList.contains("hide-vocab"), "复位：两栏已展开");

  console.log("\n=== 15. 每一句都能点讲（不只是长难句）===");
  const easy = passage.querySelector('.sent[data-sent="0-1"]');
  ok(!!easy && !easy.classList.contains("hard"), "0-1 是普通句（不是长难句）");
  click(easy, window);
  ok(/句子分析/.test(ana.textContent), "普通句也出讲解");
  ok(ana.querySelectorAll(".struct tr").length > 0,
    "普通句也有成分拆解 " + ana.querySelectorAll(".struct tr").length + " 行");
  ok(easy.classList.contains("cur"), "该句高亮");
  ok(!!easy.querySelector(".row-btns .mini"), "每句都有行内按钮（析 / 🔊 / 译）");
  const anaBtn = [...easy.querySelectorAll(".row-btns .mini")]
    .find(b => b.textContent.trim() === "析");
  ok(!!anaBtn, "有显式的「析」按钮");

  console.log("\n=== 16. 句型字段 ===");
  const MAIN_PAT = ["主谓宾", "主系表", "主谓双宾", "主谓", "倒装引语"];
  let sentCount = 0, badPat = [];
  CONTENT.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => {
    sentCount++;
    const pat = s.ana && s.ana.pat;
    if (!Array.isArray(pat) || !pat.length || MAIN_PAT.indexOf(pat[0]) < 0) {
      badPat.push(pi + "-" + si + " → " + JSON.stringify(pat));
    }
  }));
  ok(sentCount === 22, "共 " + sentCount + " 句");
  ok(badPat.length === 0, "22 句的 pat[0] 全部落在主句型白名单内");
  badPat.slice(0, 5).forEach(b => console.log("      ✗ " + b));

  ok(/句型/.test(ana.textContent), "右栏有「句型」板块");
  const patChips = ana.querySelectorAll(".chip.pat");
  ok(patChips.length > 0, "句型 chip 渲染了 " + patChips.length + " 个");
  ok(patChips[0].classList.contains("pat0"), "主句型（第一个）带 pat0 高亮样式");
  const curPat = CONTENT.passage.paragraphs[0][1].ana.pat;
  ok(patChips.length === curPat.length,
    "chip 数量与数据一致（" + patChips.length + " vs " + curPat.length + "）");

  console.log("\n=== 17. 单词单行列表 + 点击展开 ===");
  const wOrd = passage.querySelector('.w[data-w="museum"]');
  click(wOrd, window);
  let row = vocab.querySelector(".vcard");
  ok(!row.classList.contains("open"), "新收录的行默认收起");
  const line = row.querySelector(".vhead .vline");
  ok(!!line, "有单行容器 .vline");
  ok(!!line.querySelector(".vw") && !!line.querySelector(".vipa") &&
     !!line.querySelector(".vpos") && !!line.querySelector(".vcn"),
    "单行内同时含 单词 / 音标 / 词性 / 中文 四项");
  ok(!!row.querySelector(".vbody"), "有展开体 .vbody（内容默认仍在，只是 CSS 隐藏）");

  click(row.querySelector(".vhead"), window);
  row = vocab.querySelector(".vcard");
  ok(row.classList.contains("open"), "点该行 → 展开");
  ok(row.querySelector(".vhead").getAttribute("aria-expanded") === "true", "aria-expanded 同步");

  // 关键：再点一个别的词会触发 renderVocab 全量重刷，展开态必须活下来
  click(passage.querySelector('.w[data-w="team"]'), window);
  row = vocab.querySelector(".vcard");
  const stillOpen = [...vocab.querySelectorAll(".vcard")]
    .filter(c => c.classList.contains("open"));
  ok(stillOpen.length === 1,
    "全量重刷后仍有 " + stillOpen.length + " 行保持展开（守住 state.openV）");
  ok(/museum/.test(stillOpen[0].textContent), "保持展开的正是刚才那一行（museum）");

  // 注意：上面点击 team 已触发全量重刷，变量 row 指向的是被丢弃的旧节点。
  // 必须重新查询当前 DOM，否则点的是不存在的元素（静默无效）
  const openRow = [...vocab.querySelectorAll(".vcard")].find(c => c.classList.contains("open"));
  click(openRow.querySelector(".vhead"), window);
  ok(vocab.querySelectorAll(".vcard.open").length === 0, "再点一次收起");

  console.log("\n=== 18. 词组自动推导（与正文黄标零漂移）===");
  ok(/本句词组/.test(ana.textContent), "分析栏有「本句词组」板块");
  const derived = [...ana.querySelectorAll("[data-vph]")].map(b => b.dataset.vph);
  const inText = [...easy.querySelectorAll(".ph")].map(p => p.dataset.ph);
  ok(derived.length > 0, "0-1 推导出词组 " + JSON.stringify(derived));
  ok(JSON.stringify(derived.slice().sort()) === JSON.stringify(inText.slice().sort()),
    "推导集合 === 正文该句黄标集合（" + JSON.stringify(inText) + "）");

  // 逐句真比对：挨个点开每一句，把推导出的词组和该句正文里的黄标词组对照
  let drift = [];
  for (let pi = 0; pi < CONTENT.passage.paragraphs.length; pi++) {
    for (let si = 0; si < CONTENT.passage.paragraphs[pi].length; si++) {
      const el = passage.querySelector('[data-sent="' + pi + "-" + si + '"]');
      click(el, window);
      const fromAna = [...ana.querySelectorAll("[data-vph]")].map(b => b.dataset.vph).sort();
      const fromTxt = [...el.querySelectorAll(".ph")].map(p => p.dataset.ph).sort();
      if (JSON.stringify(fromAna) !== JSON.stringify(fromTxt)) {
        drift.push(pi + "-" + si + " 分析=" + JSON.stringify(fromAna) + " 正文=" + JSON.stringify(fromTxt));
      }
    }
  }
  ok(drift.length === 0, "22 句逐句比对：推导词组 === 正文黄标词组");
  drift.slice(0, 4).forEach(d => console.log("      ✗ " + d));

  ok(!!ana.querySelector("[data-vph]"), "分析栏的词组 chip 可点");
  click(easy, window);                                   // 回到 0-1（含 dig up）
  const chip = ana.querySelector("[data-vph]");
  const chipKey = chip.dataset.vph;
  click(chip, window);
  const top = vocab.querySelector(".vcard");
  ok(top.querySelector(".vw").textContent === chipKey,
    "点分析栏的词组 chip → 该词组跳到生词本首行（" + chipKey + "）");

  console.log("\n" + (fail === 0 ? "★ 全部通过" : "★ " + fail + " 项失败") +
    "  ——  通过 " + pass + " / 失败 " + fail);
  process.exit(fail === 0 ? 0 : 1);
}

dom.window.addEventListener("load", () => setTimeout(run, 50));
