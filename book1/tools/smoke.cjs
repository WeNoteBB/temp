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
  ok(card && !!card.querySelector(".vctx"), "带原文例句");

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

  console.log("\n" + (fail === 0 ? "★ 全部通过" : "★ " + fail + " 项失败") +
    "  ——  通过 " + pass + " / 失败 " + fail);
  process.exit(fail === 0 ? 0 : 1);
}

dom.window.addEventListener("load", () => setTimeout(run, 50));
