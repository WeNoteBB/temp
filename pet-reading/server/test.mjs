/* PET 精读后端 · 单测（不需要数据库）
   用法： node test.mjs

   路由测试用「假 db」（记录调用、返回罐头数据）+ 真 fetch 打真 HTTP 端口，
   覆盖路由、参数校验、错误处理这一圈；SQL 本身由 selftest.mjs 打真库验证。

   断言账本的写法和 tools/ 下保持一致。
*/

import { createApp } from "./server.mjs";
import { sha256Hex, fitText, fitChars, validPhone, normPhone, normWord, normSentence,
         normNickname, validNickname, validPassword, hashPassword, verifyPassword,
         levelColor, LEVEL_COLORS, SLUG_RE } from "./lib.mjs";

let nPass = 0, nFail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { nPass++; return true; }
  nFail++; failures.push(msg); return false;
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b),
    msg + "（实际 " + JSON.stringify(a) + "，期望 " + JSON.stringify(b) + "）");
}

/* ============================================================
   1. 纯函数
   ============================================================ */
{
  eq(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "sha256 符合已知向量");
  ok(sha256Hex("你好，世界").length === 64, "sha256 是 64 位小写十六进制");
  eq(sha256Hex(" A "), sha256Hex(" A "), "同样输入同样哈希");

  eq(normPhone("138 0013-8000"), "13800138000", "手机号清洗空格/横线");
  ok(validPhone("13800138000"), "合法手机号通过");
  ok(!validPhone("12800138000"), "1[^3-9] 开头被拒");
  ok(!validPhone("1380013800"), "10 位被拒");
  ok(!validPhone(""), "空手机号被拒");

  eq(normWord("  century "), "century", "word 会 trim");
  eq(normSentence("  Hello. "), "Hello.", "sentence 会 trim");

  eq(fitText("abc", 2), "ab", "fitText 按字节截断");
  ok(Buffer.byteLength(fitText("你好世界", 7), "utf8") <= 7, "fitText 不切碎多字节字符");
  eq(fitText("", 0), "", "fitText 空串不炸");
  eq(fitChars("你好世界", 2), "你好", "fitChars 按字符截断（varchar 用）");
  eq(fitChars("abc", 64), "abc", "fitChars 不截短的不动");

  /* ---- 昵称 / 密码 / 等级颜色 / slug ---- */
  eq(normNickname("  小明\u0007 "), "小明", "昵称去控制字符再 trim");
  ok(validNickname("小明"), "1 个字的昵称可以");
  ok(validNickname("x".repeat(16)), "16 字的昵称可以");
  ok(!validNickname(""), "空昵称被拒");
  ok(!validNickname("   "), "全空白昵称被拒");
  ok(!validNickname("x".repeat(17)), "17 字昵称被拒");

  ok(validPassword("secret123"), "6 位以上密码可以");
  ok(validPassword("密".repeat(64)), "64 位密码可以");
  ok(!validPassword("12345"), "5 位密码被拒");
  ok(!validPassword("x".repeat(65)), "65 位密码被拒");

  const h1 = hashPassword("secret123");
  ok(/^scrypt\$[0-9a-f]+\$[0-9a-f]{64}$/.test(h1), "密码散列形状 scrypt$盐$散列");
  ok(verifyPassword("secret123", h1), "密码校验通过");
  ok(!verifyPassword("secret124", h1), "错误密码被拒");
  ok(!verifyPassword("anything", ""), "空散列被拒（不是抛异常）");
  ok(!verifyPassword("anything", "md5$junk"), "格式不对的散列被拒");
  ok(hashPassword("same") !== hashPassword("same"), "同密码两次散列的盐不同");

  eq(LEVEL_COLORS.length, 18, "等级色 18 个");
  eq(levelColor(1), "#3171d8", "1 级是蓝");
  eq(levelColor(18), "#d8ae31", "18 级是金");
  eq(levelColor(0), "#3171d8", "等级越界往下钳到 1");
  eq(levelColor(99), "#d8ae31", "等级越界往上钳到 18");

  ok(SLUG_RE.test("t1-p4-digging-into-the-past"), "合法 slug 通过");
  ok(!SLUG_RE.test("T1-P4"), "大写 slug 被拒");
  ok(!SLUG_RE.test("-lead"), "连字符开头被拒");
  ok(!SLUG_RE.test("a".repeat(65)), "超长 slug 被拒");
}

/* ============================================================
   2. 事先声明：断言对象（后面按实际调用检查）
   ============================================================ */

function fakeDb(opts) {
  opts = opts || {};
  const calls = [];
  /* 罐头用户：13800138000 已注册（密码 secret123，3 级）。
     别的手机号 getUserByPhone 返回 null —— 用来测「没注册」。 */
  const users = {};
  users["13800138000"] = {
    id: 42, phone: "13800138000", nickname: "小明",
    pass_hash: hashPassword("secret123"), user_level: 3
  };
  users["13800138001"] = {
    id: 43, phone: "13800138001", nickname: "",
    pass_hash: "", user_level: 1
  };
  return {
    calls,
    async ping() { calls.push(["ping"]); return undefined; },
    async ensureUser(phone) { calls.push(["ensureUser", phone]); return 42; },
    async getUserByPhone(phone) {
      calls.push(["getUserByPhone", phone]);
      return users[phone] || null;
    },
    async getLevelColor(level) { return levelColor(level); },
    async userShape(row) {
      return { phone: row.phone, nickname: row.nickname || "",
               level: parseInt(row.user_level, 10) || 1, color: levelColor(row.user_level) };
    },
    async registerUser(a) {
      calls.push(["registerUser", a]);
      if (opts.registerExists) return { exists: true };
      /* 模拟真库行为：建号 / 补密码之后，getUserByPhone 就能查到这行 */
      const existing = users[a.phone];
      users[a.phone] = {
        id: existing ? existing.id : 99,
        phone: a.phone,
        nickname: a.nickname,
        pass_hash: a.passHash,
        user_level: existing ? existing.user_level : 1
      };
      return { userId: users[a.phone].id, completed: !!existing };
    },
    async listFavs(phone) {
      calls.push(["listFavs", phone]);
      return { items: [{ type: "w", key: "century", cn: "世纪", ts: 1 }] };
    },
    async addWordFav(a) { calls.push(["addWordFav", a]); return { wordId: 7 }; },
    async removeWordFav(a) { calls.push(["removeWordFav", a]); return { removed: 1 }; },
    async addSentenceFav(a) { calls.push(["addSentenceFav", a]); return { sentenceId: 9, hash: "h".repeat(64) }; },
    async removeSentenceFav(a) { calls.push(["removeSentenceFav", a]); return { removed: 1 }; },
    async addMistake(a) { calls.push(["addMistake", a]); return { ok: true }; },
    async listMistakes(phone) {
      calls.push(["listMistakes", phone]);
      return { items: [{ slug: "t1-p4-digging-into-the-past", q: 16, chosen: "B", correct: "C", count: 2, ts: 1 }] };
    }
  };
}

/* 起一个真端口，用真 fetch 打（Node 18+ 自带 fetch） */
async function withServer(db, fn) {
  const app = createApp(db, { log: { error() {} } });
  const srv = await new Promise(res => {
    const s = app.listen(0, "127.0.0.1", () => res(s));
  });
  const base = "http://127.0.0.1:" + srv.address().port;
  try { await fn(base); }
  finally { await new Promise(res => srv.close(res)); }
}

const post = (base, p, body) =>
  fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(async r => ({ status: r.status, j: await r.json() }));

const postRaw = (base, p, raw) =>
  fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw
  }).then(async r => ({ status: r.status, j: await r.json() }));

const get = (base, p) =>
  fetch(base + p).then(async r => ({ status: r.status, j: await r.json() }));

/* ============================================================
   3. 路由
   ============================================================ */
{
  const db = fakeDb();
  await withServer(db, async base => {
    let r = await get(base, "/api/health");
    ok(r.status === 200 && r.j.ok === true && r.j.db === "up", "health 返回 ok + db=up");

    /* -- 注册 -- */
    r = await post(base, "/api/register", { phone: "138 0013-9000", nickname: " 小红 ", password: "secret123" });
    eq(r.status, 200, "注册成功 200");
    eq(r.j.user, { phone: "13800139000", nickname: "小红", level: 1, color: "#3171d8" },
      "注册返回用户形状（手机号清洗、昵称 trim、1 级蓝色）");
    let rc = db.calls.filter(x => x[0] === "registerUser").pop()[1];
    eq(rc.phone, "13800139000", "registerUser 拿到清洗后的手机号");
    ok(verifyPassword("secret123", rc.passHash), "密码以 scrypt 散列进库（能验证，不是原文）");
    ok(!String(rc.passHash).includes("secret123"), "散列里不含密码原文");

    r = await post(base, "/api/register", { phone: "13800139000", nickname: "", password: "secret123" });
    ok(r.status === 400, "空昵称 → 400");
    r = await post(base, "/api/register", { phone: "13800139000", nickname: "x".repeat(17), password: "secret123" });
    ok(r.status === 400, "17 字昵称 → 400");
    r = await post(base, "/api/register", { phone: "13800139000", nickname: "小红", password: "12345" });
    ok(r.status === 400, "5 位密码 → 400");
    r = await post(base, "/api/register", { phone: "123", nickname: "小红", password: "secret123" });
    ok(r.status === 400, "非法手机号 → 400");

    /* -- 登录 -- */
    r = await post(base, "/api/login", { phone: "13800138000", password: "secret123" });
    eq(r.status, 200, "登录成功 200");
    eq(r.j.user, { phone: "13800138000", nickname: "小明", level: 3, color: levelColor(3) },
      "登录返回昵称 + 等级 + 颜色");

    r = await post(base, "/api/login", { phone: "13800138000", password: "wrong123" });
    ok(r.status === 400 && /密码/.test(r.j.err), "密码不对 → 400 且提示密码");
    r = await post(base, "/api/login", { phone: "13800139999", password: "secret123" });
    ok(r.status === 400 && /注册/.test(r.j.err), "没注册过的号 → 400 提示去注册");
    r = await post(base, "/api/login", { phone: "13800138001", password: "secret123" });
    ok(r.status === 400 && /密码/.test(r.j.err), "有号但没设过密码 → 400 提示去注册（设密码）");
    r = await post(base, "/api/login", { phone: "13800138000" });
    ok(r.status === 400, "没填密码 → 400");
    r = await post(base, "/api/login", { phone: "123", password: "secret123" });
    ok(r.status === 400, "非法手机号 → 400");

    /* -- me -- */
    r = await get(base, "/api/me?phone=13800138000");
    eq(r.j, { ok: true, user: { phone: "13800138000", nickname: "小明", level: 3, color: levelColor(3) } },
      "me 返回用户形状");
    r = await get(base, "/api/me?phone=13800139999");
    ok(r.status === 200 && r.j.ok === true && r.j.user === null, "me 查无此人：200 + user:null（不是错误）");
    r = await get(base, "/api/me?phone=oops");
    ok(r.status === 400, "me 手机号非法 → 400");

    /* -- 错题 -- */
    r = await post(base, "/api/mistakes", { phone: "13800138000", slug: "t1-p4-digging-into-the-past", q: 16, chosen: "b", correct: "C" });
    ok(r.status === 200 && r.j.ok === true, "错题登记成功");
    let mc = db.calls.filter(x => x[0] === "addMistake").pop()[1];
    eq([mc.phone, mc.slug, mc.qN, mc.chosen, mc.correct],
      ["13800138000", "t1-p4-digging-into-the-past", 16, "B", "C"], "选项字母统一转大写后透传");
    r = await post(base, "/api/mistakes", { phone: "13800138000", slug: "T1-P4", q: 16, chosen: "B", correct: "C" });
    ok(r.status === 400, "非法 slug → 400");
    r = await post(base, "/api/mistakes", { phone: "13800138000", slug: "t1-x", q: 0, chosen: "B", correct: "C" });
    ok(r.status === 400, "题号 0 → 400");
    r = await post(base, "/api/mistakes", { phone: "13800138000", slug: "t1-x", q: 16, chosen: "9", correct: "C" });
    ok(r.status === 400, "选项不是字母 → 400");
    r = await post(base, "/api/mistakes", { phone: "13800138000", slug: "t1-x", q: 16, chosen: "B" });
    ok(r.status === 400, "缺 correct → 400");
    r = await get(base, "/api/mistakes?phone=13800138000");
    ok(r.status === 200 && r.j.items[0].q === 16 && r.j.items[0].count === 2, "错题列表返回 items");
    r = await get(base, "/api/mistakes?phone=oops");
    ok(r.status === 400, "错题列表手机号非法 → 400");

    r = await post(base, "/api/login", { phone: "123" });
    ok(r.status === 400 && r.j.ok === false, "非法手机号 → 400");

    /* -- add word（把内容里有的字段全带上） -- */
    r = await post(base, "/api/favs/add", {
      phone: "13800138000", kind: "word", word: " century ", meaning: "世纪",
      phonetic: "/ˈsentʃəri/", pos: "n.",
      example: "This century was hard.", exampleTranslation: "这个世纪很难。",
      exampleAnalysis: "{\"pat\":[\"主系表\"]}", phrase: "the twentieth century",
      sourceTitle: "Digging into the past"
    });
    ok(r.status === 200 && r.j.ok === true && r.j.wordId === 7, "add word 成功");
    let c = db.calls.filter(x => x[0] === "addWordFav").pop()[1];
    eq([c.phone, c.word, c.meaning], ["13800138000", "century", "世纪"], "word trim + 字段透传");
    eq([c.phonetic, c.pos], ["/ˈsentʃəri/", "n."], "音标/词性透传");
    eq([c.example, c.exampleTranslation], ["This century was hard.", "这个世纪很难。"], "例句原文/翻译透传");
    ok(c.exampleAnalysis.indexOf("主系表") >= 0 && c.phrase === "the twentieth century", "例句分析/搭配透传");
    eq(c.mnemonic, "", "没带 mnemonic 时给空串（库里落 NULL）");

    r = await post(base, "/api/favs/add", {
      phone: "13800138000", kind: "word", word: "cap",
      phonetic: "x".repeat(200), pos: "y".repeat(100)
    });
    c = db.calls.filter(x => x[0] === "addWordFav").pop()[1];
    ok(c.phonetic.length === 128 && c.pos.length === 64, "phonetic/pos 按 varchar 长度截断（128/64）");

    r = await post(base, "/api/favs/add", { phone: "13800138000", kind: "word", word: "x".repeat(65) });
    ok(r.status === 400, "word 超 64 字符 → 400（客户端会把它从补写队列里丢掉）");

    r = await post(base, "/api/favs/add", { phone: "13800138000", kind: "word", word: "   " });
    ok(r.status === 400, "空 word → 400");

    /* -- add sentence -- */
    r = await post(base, "/api/favs/add", {
      phone: "13800138000", kind: "sentence", sentence: " Hello. ",
      translation: "你好。", analysis: "{\"pat\":[\"主谓\"]}", sourceTitle: "T"
    });
    ok(r.status === 200 && r.j.ok === true && r.j.hash === "h".repeat(64), "add sentence 成功并回 hash");
    c = db.calls.filter(x => x[0] === "addSentenceFav").pop()[1];
    eq([c.sentence, c.translation, c.sourceTitle], ["Hello.", "你好。", "T"], "sentence trim + 字段透传");
    ok(c.analysis.indexOf("主谓") >= 0, "analysis 透传（客户端已 JSON.stringify）");

    r = await post(base, "/api/favs/add", { phone: "13800138000", kind: "sentence", sentence: "   " });
    ok(r.status === 400, "空句子 → 400");

    r = await post(base, "/api/favs/add", { phone: "13800138000", kind: "phrase", word: "no-one" });
    ok(r.status === 400, "未知 kind → 400");

    /* -- remove -- */
    r = await post(base, "/api/favs/remove", { phone: "13800138000", kind: "word", word: "century" });
    ok(r.status === 200 && r.j.ok === true && r.j.removed === 1, "remove word 成功");
    ok(db.calls.filter(x => x[0] === "removeWordFav").length === 1, "remove word 到达 db");

    r = await post(base, "/api/favs/remove", { phone: "13800138000", kind: "sentence", sentence: "Hello." });
    ok(r.status === 200 && db.calls.filter(x => x[0] === "removeSentenceFav").length === 1, "remove sentence 到达 db");

    r = await post(base, "/api/favs/remove", { phone: "13800138000", kind: "sentence", sentence: "  " });
    ok(r.status === 400, "remove 空句子 → 400");

    /* -- list -- */
    r = await get(base, "/api/favs?phone=13800138000");
    ok(r.status === 200 && Array.isArray(r.j.items) && r.j.items[0].key === "century", "list 返回 items");

    r = await get(base, "/api/favs?phone=oops");
    ok(r.status === 400, "list 手机号非法 → 400");

    /* -- 非法 JSON -- */
    r = await postRaw(base, "/api/favs/add", "{oops");
    ok(r.status === 400 && r.j.ok === false, "请求体不是合法 JSON → 400 而不是 500");
  });
}

/* ============================================================
   4. 注册的两种边界：已注册过 → 400；老用户补设密码 → 成功
   ============================================================ */
{
  const db = fakeDb({ registerExists: true });
  await withServer(db, async base => {
    const r = await post(base, "/api/register", { phone: "13800138999", nickname: "小红", password: "secret123" });
    ok(r.status === 400 && /已经注册过/.test(r.j.err), "已设过密码的手机号再注册 → 400");
  });
}
{
  const db = fakeDb();
  await withServer(db, async base => {
    const r = await post(base, "/api/register", { phone: "13800138001", nickname: "补个名", password: "secret123" });
    ok(r.status === 200 && r.j.completed === true, "老用户（没设过密码）注册 = 补设昵称密码，completed:true");
  });
}

/* ============================================================
   5. 错误处理：db 挂了 → 500，且不透传内部细节
   ============================================================ */
{
  const db = fakeDb();
  db.listFavs = async () => { throw new Error("boom-secret-detail"); };
  await withServer(db, async base => {
    const r = await get(base, "/api/favs?phone=13800138000");
    ok(r.status === 500 && r.j.ok === false, "db 抛异常 → 500");
    ok(!JSON.stringify(r.j).includes("boom"), "500 响应里没有内部错误细节");
  });
}

/* ============================================================
   汇总
   ============================================================ */
if (nFail) {
  console.log("\n✗ 失败 " + nFail + " 条：");
  failures.forEach(f => console.log("   · " + f));
  console.log("\n通过 " + nPass + " / 失败 " + nFail);
  process.exit(1);
} else {
  console.log("✓ server 单测通过：" + nPass + " 条断言");
}
