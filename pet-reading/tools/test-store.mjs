/* store.js 的单元测试
   用法： node tools/test-store.mjs

   为什么单独测它：store.js 是前端唯一的数据层（登录态 / 收藏 / 主题）。
   收藏现在是「本地即时 + 后台补写」：本地表立刻写（星星不等网络），
   增删进补写队列，联网后推给 server/ 的后端。这个测试锁的是「接口的语义」，
   本地模式和不给 fetch 的行为都要和从前一样。

   跑在 node:vm 里而不是 jsdom 里，因为要覆盖「localStorage 读取即抛异常」
   （Safari 禁止网站数据时就是这样）和「location.replace 被调用」这两种情况 ——
   jsdom 的 location 是只读的，换不掉。
*/
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODE = fs.readFileSync(path.join(root, "engine", "store.js"), "utf8");

/* ============================================================
   断言账本（与 verify / smoke 同一套写法）
   ============================================================ */
let nPass = 0, nFail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { nPass++; return true; }
  nFail++; failures.push(msg); return false;
}
/* vm 里造出来的对象，原型来自另一个 realm，deepStrictEqual 会因原型不同而报错。
   比字符串最省事，也够看。 */
const j = v => JSON.stringify(v === undefined ? null : v);
const eq = (a, b, msg) => ok(j(a) === j(b), msg + "（实际 " + j(a) + "，期望 " + j(b) + "）");

/* ============================================================
   沙箱：一个够用的假浏览器
   ============================================================ */
function makeSandbox(opts) {
  opts = opts || {};
  const bag = new Map(opts.seed || []);

  const ls = {
    getItem: k => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => { if (opts.readOnlyWrite) throw new Error("QuotaExceededError"); bag.set(k, String(v)); },
    removeItem: k => { bag.delete(k); },
    _bag: bag
  };

  const win = {
    location: {
      href: "https://x.test/t1-p4.html",
      origin: "https://x.test",
      pathname: "/t1-p4.html",
      search: "",
      hash: "",
      replaced: null,
      replace(u) { this.replaced = u; }
    },
    matchMedia: () => ({ matches: !!opts.dark, addEventListener() {} })
  };

  /* 三种坏掉的存储：
       access —— 读属性就抛（Safari 禁止网站数据）
       write  —— 对象在、写就抛（隐私模式配额 0）
       都不设 —— 正常 */
  if (opts.lsBroken === "access") {
    Object.defineProperty(win, "localStorage", {
      get() { throw new Error("SecurityError: The operation is insecure."); }
    });
  } else if (opts.lsBroken === "write") {
    win.localStorage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
  } else {
    win.localStorage = ls;
  }

  const html = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  };

  /* 只塞 host 这边缺不了的东西（URL 在 vm 里没有）。
     其余内建一律让 vm 自己提供 —— 把 host 的 Object / JSON 灌进去，
     会让 vm 里造出来的对象和 host 的不是一个 realm，后面比什么都别扭。 */
  const sandbox = {
    window: win,
    document: { documentElement: html, querySelector: () => null },
    URL,
    /* quiet：3c 那节会刻意触发「400 条目被丢弃」的 console.warn，测试输出里别要它 */
    console: opts.quiet ? { log() {}, warn() {}, error() {} } : console
  };
  /* fetch 是给「联网模式」的测试注入的假实现；不给就不放 ——
     store.js 见 typeof fetch !== "function" 就整条后端链路降级为纯本地。
     注：浏览器里 fetch 就是全局，vm 里也得挂在全局（sandbox）上，挂 win 上没用。 */
  if (opts.fetch) sandbox.fetch = opts.fetch;

  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: "store.js" });
  return { store: win.PETStore, win, html, bag };
}

const fresh = opts => makeSandbox(opts).store;

/* ============================================================
   1. 可用性判断
   ============================================================ */
{
  ok(fresh().available() === true, "正常浏览器：available() 为 true");

  const a = fresh({ lsBroken: "access" });
  let threw = false;
  let avail;
  try { avail = a.available(); } catch (e) { threw = true; }
  ok(!threw, "localStorage 读取即抛异常时，available() 不能把异常漏出去");
  ok(avail === false, "localStorage 读取即抛异常时，available() 返回 false");

  const w = fresh({ lsBroken: "write" });
  ok(w.available() === false, "写得进去才算可用：写抛异常的（隐私模式配额 0）也要返回 false");

  ok(fresh().available() === fresh().available(), "available() 可重复调用");
}

/* ============================================================
   2. 登录态（注册 / 登录 / 14 天保持 / 资料刷新）
   ============================================================ */
{
  const s = fresh();
  eq(await s.getUser(), null, "没登录过时 getUser() 是 null");

  /* 登录 / 注册现在都要打后端校验密码：没有 fetch 时如实报「连不上」，不假成功 */
  const noNet = fresh();
  const nn = await noNet.login("13800138000", "secret123");
  ok(nn.ok === false && /连不上/.test(nn.err), "没有 fetch（无网）时登录失败并说明原因");
  const nn2 = await noNet.register("13800138000", "小明", "secret123");
  ok(nn2.ok === false && /连不上/.test(nn2.err), "没有 fetch 时注册失败并说明原因");
  eq(await noNet.getUser(), null, "失败不写登录态");

  /* 假后端：密码 secret123 能过，其他密码 400 */
  const calls = [];
  const mkRes = (status, body) => ({ ok: status < 400, status, json: () => Promise.resolve(body) });
  const backend = (url, init) => {
    const path = String(url).replace(/^.*\/api/, "/api");
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    if (path.indexOf("/api/login") === 0) {
      if (body.password === "secret123") {
        return Promise.resolve(mkRes(200, { ok: true, user: { phone: body.phone, nickname: "小明", level: 3, color: "#31d896" } }));
      }
      return Promise.resolve(mkRes(400, { ok: false, err: "密码不对，再试一次" }));
    }
    if (path.indexOf("/api/register") === 0) {
      return Promise.resolve(mkRes(200, { ok: true, completed: false,
        user: { phone: body.phone, nickname: body.nickname, level: 1, color: "#3171d8" } }));
    }
    if (path.indexOf("/api/me") === 0) {
      return Promise.resolve(mkRes(200, { ok: true, user: { phone: "13800138000", nickname: "小明", level: 5, color: "#31d8b2" } }));
    }
    return Promise.resolve(mkRes(404, { ok: false, err: "no route" }));
  };
  const s2 = fresh({ fetch: backend });

  const bad = await s2.login("1380013800", "secret123");     // 10 位
  ok(bad.ok === false && /11 位/.test(bad.err), "10 位手机号被拒（本地先拦，不打网络）");
  const bad2 = await s2.login("12800138000", "secret123");   // 第二位不是 3-9
  ok(bad2.ok === false, "1[^3-9] 开头的手机号被拒");
  const bad3 = await s2.login("138 0013 8000");              // 没填密码
  ok(bad3.ok === false && /密码/.test(bad3.err), "没填密码被本地拦住");
  eq(await s2.getUser(), null, "校验失败不留痕迹");

  const wrongPw = await s2.login("138 0013 8000", "wrong-pw");
  ok(wrongPw.ok === false && /密码不对/.test(wrongPw.err), "密码不对：把服务器的原话带回来");

  const good = await s2.login("138 0013 8000", "secret123");   // 带空格：先清洗再判
  ok(good.ok === true && good.persisted === true, "手机号 + 正确密码登录成功且落盘");
  ok(calls.some(c => c.path === "/api/login" && c.body && c.body.phone === "13800138000"),
    "登录打的是 /api/login 且手机号已清洗");

  const u = await s2.getUser();
  eq(u && u.phone, "13800138000", "getUser() 拿回手机号");
  eq(u && u.nickname, "小明", "登录态带了昵称（首页圆圈 / 顶栏角标要用）");
  eq(u && u.level, 3, "登录态带了等级");
  eq(u && u.color, "#31d896", "登录态带了等级颜色");
  ok(typeof (u && u.ts) === "number", "登录态带时间戳");

  /* 14 天保持：过期即未登录，并顺手清掉；13 天内仍有效 */
  const stale = makeSandbox({ seed: [["pet:user:v1", j({ phone: "13800138000", ts: Date.now() - 15 * 24 * 3600 * 1000 })]] });
  eq(await stale.store.getUser(), null, "登录态超过 14 天 → 视为未登录");
  ok(stale.bag.get("pet:user:v1") === undefined, "过期的登录态被顺手清掉");
  const kept = makeSandbox({ seed: [["pet:user:v1", j({ phone: "13800138000", ts: Date.now() - 13 * 24 * 3600 * 1000 })]] });
  ok((await kept.store.getUser()) !== null, "13 天内的登录态仍然有效");

  /* 注册：本地校验 + 成功路径 */
  const rBad = await s2.register("13800139000", "", "secret123");
  ok(rBad.ok === false && /昵称/.test(rBad.err), "空昵称被拒");
  const rBad2 = await s2.register("13800139000", "x".repeat(17), "secret123");
  ok(rBad2.ok === false && /昵称/.test(rBad2.err), "17 字昵称被拒");
  const rBad3 = await s2.register("13800139000", "小红", "12345");
  ok(rBad3.ok === false && /密码/.test(rBad3.err), "5 位密码被拒");
  const rGood = await s2.register("139 0013-9000", "小红", "secret123");
  ok(rGood.ok === true && rGood.user.nickname === "小红" && rGood.user.level === 1,
    "注册成功返回用户（昵称 / 1 级 / 颜色）");
  eq((await s2.getUser()).phone, "13900139000", "注册成功即登录（登录态换成新号）");

  /* refreshProfile：拉最新昵称/等级写回缓存；离线时返回缓存、绝不清登录态 */
  const p = await s2.refreshProfile();
  eq(p && p.nickname, "小明", "refreshProfile 拉到新昵称");
  eq(p && p.level, 5, "refreshProfile 拉到新等级");
  ok((await s2.getUser()).level === 5, "刷新后的资料写回登录态缓存");
  const off = makeSandbox({ seed: [["pet:user:v1", j({ phone: "13800138000", ts: Date.now(), nickname: "缓存名" })]] });
  const off2 = await off.store.refreshProfile();
  ok(off2 && off2.nickname === "缓存名", "离线 refreshProfile 返回缓存，不登出");

  eq(s2.maskPhone("13800138000"), "138****8000", "脱敏格式 138****8000");
  eq(s2.maskPhone(""), "", "空串脱敏不炸");

  /* 存不住时：服务器说 ok 也照样放行（门禁在存储不可用时是开的） */
  const broken = fresh({ lsBroken: "access", fetch: backend });
  const r = await broken.login("13800138000", "secret123");
  ok(r.ok === true && r.persisted === false, "存储不可用时登录仍返回 ok，但如实说明没落盘");

  await s2.logout();
  eq(await s2.getUser(), null, "logout() 之后 getUser() 回到 null");
}

/* ============================================================
   2b. 学到哪儿了（本机先记着；以后换 Redis 不改接口）
   ============================================================ */
{
  const s = fresh();
  eq(await s.getLastRead(), null, "没记过时 getLastRead 是 null");

  await s.setLastRead("t1-p4", "2-3");
  let lr = await s.getLastRead();
  eq([lr.slug, lr.ref], ["t1-p4", "2-3"], "记下篇 + 句子位置");

  await s.setLastRead("t1-p4", "");
  eq((await s.getLastRead()).ref, "2-3", "ref 传空：同一篇保留上次的位置");

  await s.setLastRead("t2-p1", "");
  lr = await s.getLastRead();
  eq([lr.slug, lr.ref], ["t2-p1", ""], "换篇后 slug 更新、没有旧 ref 可保留 → 空");

  /* 按手机号分账：换一个号登录看不到别人的进度 */
  const other = makeSandbox({ seed: [["pet:user:v1", j({ phone: "13900139000", ts: Date.now() })]] });
  eq(await other.store.getLastRead(), null, "换个手机号看不到别人的进度（按号分账）");
}

/* ============================================================
   2c. 错题登记
   ============================================================ */
{
  const reqs = [];
  const fb = (url, init) => {
    const path = String(url).replace(/^.*\/api/, "/api");
    const body = init && init.body ? JSON.parse(init.body) : null;
    reqs.push({ path, body });
    if (path.indexOf("/api/mistakes") === 0 && init && init.method === "POST") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    }
    if (path.indexOf("/api/mistakes") === 0) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true,
        items: [{ slug: "t1-p4", q: 16, chosen: "B", correct: "C", count: 2, ts: 1 }] }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ ok: false, err: "no route" }) });
  };
  const logged = makeSandbox({ seed: [["pet:user:v1", j({ phone: "13800138000", ts: Date.now() })]], fetch: fb });

  const r = await logged.store.addMistake({ slug: "t1-p4", q: 16, chosen: "B", correct: "C" });
  ok(r.ok === true, "错题登记成功");
  eq(reqs[0].body, { phone: "13800138000", slug: "t1-p4", q: 16, chosen: "B", correct: "C" },
    "登记体带全：手机号 / 篇 / 题号 / 我选的 / 正确答案");

  const items = await logged.store.listMistakes();
  ok(Array.isArray(items) && items[0].q === 16 && items[0].count === 2, "错题列表拿回来");

  /* 没登录 / 没 fetch：静默跳过，不抛也不报错（错题登记不该打断做题） */
  const anon = fresh();
  const r2 = await anon.addMistake({ slug: "x", q: 1, chosen: "A", correct: "B" });
  ok(r2.ok === false, "没登录时登记直接跳过");
  eq(await anon.listMistakes(), [], "没登录时列表是空的，不报错");
}

/* 造一个最小可用的假 Response（给假 fetch 用） */
const resp = (body, status) => ({
  ok: (status || 200) < 400,
  status: status || 200,
  json: () => Promise.resolve(body)
});

/* ============================================================
   3. 收藏（本地）：按词全局、按句按文本，且能取消
   ------------------------------------------------------------
   这个沙箱没有 fetch → 纯本地模式：收藏照样点亮、取消、落盘；
   补写队列只记不推（队列和联网行为在 3b / 3c / 3d 里测）。
   ============================================================ */
{
  const s = fresh();

  const w1 = { type: "w", key: "century", slug: "t1-p4", cn: "世纪" };
  const r1 = await s.addFav(w1);
  ok(r1.ok === true && r1.added === true, "首次收藏：added = true");
  ok(await s.isFav("w:century"), "收藏后 isFav 为真");
  eq((await s.listFav()).length, 1, "收藏表 1 条");

  const r2 = await s.addFav(w1);
  ok(r2.ok === true && r2.added === false, "再点一次：added = false（取消）");
  ok(!(await s.isFav("w:century")), "取消后 isFav 为假");
  eq((await s.listFav()).length, 0, "取消后收藏表清空");

  /* 同一个词换一篇再收藏 → 还是同一条（id 按词，不认 slug） */
  await s.addFav({ type: "w", key: "century", slug: "t9-p2" });
  eq((await s.listFav()).length, 1, "换一篇收藏同一个词，不是新的一条");
  ok(await s.isFav("w:century"), "跨篇 isFav 一致");
  const cross = await s.addFav({ type: "w", key: "century", slug: "t3-p1" });
  ok(cross.added === false, "在另一篇里点这颗已经亮着的星 = 取消，不是再加一条");
  eq((await s.listFav()).length, 0, "取消后不残留");

  /* 句子按「文本」：同一句话换一篇/换设备都是同一条（服务端按 sha256 去重） */
  await s.addFav({ type: "s", key: "Last year, Kate was given a chance.", ref: "0-0", slug: "t1-p4" });
  await s.addFav({ type: "s", key: "Another sentence.", ref: "0-1", slug: "t1-p4" });
  eq((await s.listFav()).length, 2, "不同文本的句子是两条");
  ok(await s.isFav("s:Last year, Kate was given a chance."), "句子 id 就是句子文本");
  const crossS = await s.addFav({ type: "s", key: "Last year, Kate was given a chance.", ref: "9-9", slug: "t9-p2" });
  ok(crossS.added === false, "同一句话换一篇再点 = 取消（同一句只有一条）");
  eq((await s.listFav()).length, 1, "取消后只剩另一句");

  eq(s.favId({ type: "w", key: "run" }), "w:run", "单词 id = 类型 + 词");
  eq(s.favId({ type: "s", key: "Hello there." }), "s:Hello there.", "句子 id = 类型 + 句子文本");

  const bad = await s.addFav({ type: "w" });
  ok(bad.ok === false, "没有 key 的收藏被拒，不写空条目");
  const badS = await s.addFav({ type: "s", ref: "0-1", slug: "x" });
  ok(badS.ok === false, "旧形状（只有 ref/slug）的句子收藏也被拒（没有 key 就没法入库）");

  /* 存储坏掉时：行为要一致（能点亮也能取消），但如实说没落盘 */
  const b = fresh({ lsBroken: "write" });
  const b1 = await b.addFav({ type: "w", key: "run" });
  const b2 = await b.addFav({ type: "w", key: "run" });
  ok(b1.added === true && b2.added === false, "存储不可用时，收藏仍能点亮 / 取消");
  ok(b1.persisted === false, "存储不可用时 persisted 为 false");
}

/* ============================================================
   3b. 补写队列：离线时操作只排队，不丢
   ============================================================ */
{
  const { store: s, bag } = makeSandbox({
    seed: [["pet:user:v1", j({ phone: "13800138000", ts: Date.now() })]]
  });
  const q = () => JSON.parse(bag.get("pet:fav:q:v1") || "[]");
  const favs = () => JSON.parse(bag.get("pet:fav:v1") || "[]");

  await s.addFav({ type: "w", key: "century", cn: "世纪" });
  eq(q().length, 1, "离线收藏 → 队列 1 条");
  eq(q()[0].op, "add", "队列第一条是 add");
  eq(q()[0].it.key, "century", "队列里带着条目内容（补写时要原样发出去）");
  eq(q()[0].ph, "13800138000", "队列条目记住了手机号（换账号登录也不会推错人）");
  eq(favs()[0].sy, 0, "还没同步的条目 sy=0");

  await s.addFav({ type: "w", key: "century" });   // 再点 = 取消
  eq(q().length, 2, "取消 → 队列再记一条");
  eq(q()[1].op, "del", "第二条是 del");
  eq(q()[1].it.key, "century", "del 只需类型 + key，不带释义");

  /* 一条也没丢：队列完整地活着，等网络回来 */
  await s.syncFavs();
  eq(q().length, 2, "没有 fetch 时 syncFavs 不动队列（等有网了再推）");
}

/* ============================================================
   3c. 联网补写：add / del 推给后端，成功后队列清空、本地标 sy=1
   ============================================================ */
{
  const reqs = [];
  const fetchMock = (url, init) => {
    reqs.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    return Promise.resolve(resp({ ok: true }));
  };
  const { store: s, bag } = makeSandbox({ fetch: fetchMock });
  const q = () => JSON.parse(bag.get("pet:fav:q:v1") || "[]");
  const favs = () => JSON.parse(bag.get("pet:fav:v1") || "[]");

  await s.login("13800138000", "secret123");
  await s.addFav({
    type: "w", key: "century", cn: "世纪", title: "Digging",
    pos: "n.", ipa: "/ˈsentʃəri/",
    ex: "This century was hard.", exTr: "这个世纪很难。",
    exAna: { pat: ["主系表"] }, ph: "the twentieth century"
  });
  await s.syncFavs();

  const add = reqs.filter(r => r.url.indexOf("/favs/add") >= 0).pop();
  ok(!!add, "联网收藏会推送到 /favs/add");
  eq(add.body.kind, "word", "kind=word");
  eq([add.body.word, add.body.meaning], ["century", "世纪"], "推送带上单词与释义");
  eq(add.body.phone, "13800138000", "推送带上手机号（后端据此找 user_id）");
  eq(add.body.pos, "n.", "推送带词性（pet_word.pos）");
  eq(add.body.phonetic, "/ˈsentʃəri/", "推送带音标（pet_word.phonetic）");
  eq(add.body.example, "This century was hard.", "推送带例句原句（pet_word.example）");
  eq(add.body.exampleTranslation, "这个世纪很难。", "推送带例句翻译");
  eq(JSON.parse(add.body.exampleAnalysis).pat[0], "主系表", "推送带例句分析（JSON 字符串）");
  eq(add.body.phrase, "the twentieth century", "推送带搭配（pet_word.phrase）");
  eq(q().length, 0, "推送成功后队列清空");
  eq(favs()[0].sy, 1, "推送成功的条目标记 sy=1");

  await s.addFav({ type: "w", key: "century" });   // 取消
  await s.syncFavs();
  const del = reqs.filter(r => r.url.indexOf("/favs/remove") >= 0).pop();
  ok(!!del && del.body.word === "century", "取消收藏推送到 /favs/remove");
  eq(q().length, 0, "删除推送成功后队列清空");

  /* 句子：原文 / 翻译 / 分析一起推（服务端据此算 hash 入库） */
  await s.addFav({
    type: "s", key: "Hello there.", cn: "你好。",
    ana: { pat: ["主谓"] }, title: "T1", ref: "0-1", slug: "x"
  });
  await s.syncFavs();
  const sadd = reqs.filter(r => r.url.indexOf("/favs/add") >= 0).pop();
  eq(sadd.body.kind, "sentence", "kind=sentence");
  eq(sadd.body.sentence, "Hello there.", "推送句子原文");
  eq(sadd.body.translation, "你好。", "推送翻译");
  eq(sadd.body.sourceTitle, "T1", "推送来源标题");
  eq(JSON.parse(sadd.body.analysis).pat[0], "主谓", "analysis 以 JSON 字符串推送");

  /* 永久失败（400）的条目要丢掉，不能堵住后面的队列 */
  const reqs2 = [];
  const fetch400 = (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    reqs2.push({ url: String(url), body });
    if (String(url).indexOf("/favs/add") >= 0 && body && body.word === "bad")
      return Promise.resolve(resp({ ok: false, err: "word 太长" }, 400));
    return Promise.resolve(resp({ ok: true }));
  };
  const s2 = makeSandbox({ fetch: fetch400, quiet: true });
  await s2.store.login("13800138000", "secret123");
  await s2.store.addFav({ type: "w", key: "bad" });
  await s2.store.addFav({ type: "w", key: "good" });
  await new Promise(r => setTimeout(r, 0));   // 等前一轮补写彻底落定
  await s2.store.syncFavs();
  ok(reqs2.some(r => r.body && r.body.word === "good"), "被拒条目后面的正常条目照常推送");
  eq(reqs2.filter(r => r.body && r.body.word === "bad").length, 1, "被 400 拒的条目只试一次，不会反复重推");
  eq(JSON.parse(s2.bag.get("pet:fav:q:v1") || "[]").length, 0, "被拒条目清出队列，不堵后面的");
}

/* ============================================================
   3d. 拉取合并：服务器上的收藏并进本地表（跨设备恢复星标）
   ============================================================ */
{
  const tick = () => new Promise(r => setTimeout(r, 0));
  const mode = { online: false };
  const reqs = [];
  let remote = [];
  const fetchMock = (url, init) => {
    reqs.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (!mode.online) return Promise.reject(new Error("offline"));
    if (String(url).indexOf("/favs?") >= 0) return Promise.resolve(resp({ ok: true, items: remote }));
    return Promise.resolve(resp({ ok: true }));
  };
  const { store: s, bag } = makeSandbox({
    fetch: fetchMock,
    /* 这个场景里登录本身也可能「没网」（mode.online 一开始是 false）——
       直接把登录态种进去，别让 login() 走网络（它失败就不写 user，手机号分账会全空）。
       登录/注册的网络路径在 2 节里单独测。 */
    seed: [["pet:user:v1", j({ phone: "13800138000", ts: Date.now() })]]
  });
  const q = () => JSON.parse(bag.get("pet:fav:q:v1") || "[]");

  /* 断网：收藏一条句子（进队列）；再收一个词后又取消它（留一条待删除） */
  await s.addFav({ type: "s", key: "Offline sentence.", cn: "离线句" });
  await s.addFav({ type: "w", key: "gone" });
  await s.addFav({ type: "w", key: "gone" });
  await tick();   // 让后台那几次失败的推送先落定

  /* 恢复联网 + 服务器上有别处收藏的三条（其中 gone 是刚在本机取消的） */
  mode.online = true;
  remote = [
    { type: "w", key: "century", cn: "世纪", ts: 1 },
    { type: "s", key: "Remote sentence.", cn: "远端句", title: "T1", ts: 2 },
    { type: "w", key: "gone", cn: "已取消", ts: 3 }
  ];
  const list = await s.listFav();
  ok(list.some(x => x.key === "century" && x.sy === 1), "服务器上的单词并进本地表（sy=1）");
  ok(list.some(x => x.key === "Remote sentence." && x.cn === "远端句"), "服务器上的句子并进本地表");
  ok(list.some(x => x.key === "Offline sentence."), "还没推上去的本地收藏不会被合并覆盖");
  ok(!list.some(x => x.key === "gone"), "本机已取消的条目，即使服务器还回传也不并进来");
  ok(await s.isFav("s:Remote sentence."), "跨设备星标：服务器句子的 id 对得上");
  ok(await s.isFav("w:century"), "跨设备星标：服务器单词的 id 对得上");

  /* 合并的同时，队列里的离线条目被补推 */
  await s.syncFavs();
  ok(reqs.some(r => r.url.indexOf("/favs/add") >= 0 && r.body && r.body.sentence === "Offline sentence."),
    "恢复联网后离线条目会被补推");
  eq(q().length, 0, "补推完队列清空");

  /* 拉回本地表在 localStorage 里也落了盘 */
  const stored = JSON.parse(bag.get("pet:fav:v1"));
  ok(stored.some(x => x.key === "Remote sentence."), "合并结果写回本地表");
}

/* ============================================================
   4. 主题
   ============================================================ */
{
  const { store: s, html } = makeSandbox();
  eq(await s.getTheme(), "auto", "默认主题是 auto");

  eq(await s.setTheme("dark"), "dark", "setTheme 回显");
  eq(await s.getTheme(), "dark", "setTheme 之后读得到");
  eq(html.getAttribute("data-theme"), "dark", "setTheme 会把 data-theme 写到 <html> 上");

  eq(await s.setTheme("乱写"), "auto", "非法值退回 auto");
  eq(html.getAttribute("data-theme"), "light", "auto 在写入前就解析成具体值（系统不是暗色 → light）");

  const dark = makeSandbox({ dark: true });
  eq(await dark.store.setTheme("auto"), "auto", "系统是暗色时 auto 仍存 auto");
  eq(dark.html.getAttribute("data-theme"), "dark", "但落到 DOM 上是 dark");

  /* 三态循环的顺序只写在 store 里 */
  const c = fresh();
  eq(await c.nextTheme(), "light", "auto → light");
  eq(await c.nextTheme(), "dark", "light → dark");
  eq(await c.nextTheme(), "auto", "dark → auto");

  /* 只有 auto 才跟随系统：存进去的值不能被系统染色 */
  ok((await s.getTheme()) === "auto", "跟随系统时存的是 auto，不是解析后的值");
}

/* ============================================================
   5. 门禁 —— 这一段是本文件最要紧的防御
   ============================================================ */
{
  /* 未登录 + 存储可用 → 回首页并自动弹登录框，next 带上原路径 */
  const { store: s, win } = makeSandbox();
  const v1 = await s.guard();
  eq(v1, "denied", "未登录时 guard 返回 denied");
  ok(win.location.replaced === "index.html?login=1&next=%2Ft1-p4.html",
    "跳首页并带回跳地址（实际 " + win.location.replaced + "）");
  ok(win.location.replaced.indexOf("http") !== 0, "回跳地址是站内相对路径，不是完整 URL");

  /* 已登录 → 放行 */
  const logged = makeSandbox({ seed: [["pet:user:v1", j({ phone: "13800138000", ts: Date.now() })]] });
  eq(await logged.store.guard(), "ok", "已登录时 guard 返回 ok");
  ok(logged.win.location.replaced === null, "已登录不跳转");

  /* ★ 存储不可用 → 必须放行。
     拦住的话：登录页写不进登录态 → 跳回文章页 → 判未登录 → 又跳登录页，
     用户被卡死在两个页面之间，怎么刷新都出不来。 */
  for (const mode of ["access", "write"]) {
    const b = makeSandbox({ lsBroken: mode });
    eq(await b.store.guard(), "open", "存储不可用（" + mode + "）时 guard 放行，不跳转");
    ok(b.win.location.replaced === null, "存储不可用（" + mode + "）时不产生跳转");
  }

  /* 同一个 promise：一页判两次也不会跳两次 */
  const once = makeSandbox();
  const [a, b] = await Promise.all([once.store.guard(), once.store.guard()]);
  ok(a === "denied" && b === "denied", "guard 可重复调用");
  ok(once.store.guard() === once.store.guard(), "第二次拿到的是同一个 promise（不会重复跳转）");

  /* ---- safeNext：next 是用户可控的，不能变成开放重定向 ---- */
  const sn = fresh().safeNext;
  eq(sn("t1-p4.html"), "t1-p4.html", "站内相对路径放行");
  eq(sn("/sub/t1-p4.html?x=1"), "/sub/t1-p4.html?x=1", "站内绝对路径放行");
  eq(sn(""), "index.html", "空值回落首页");
  eq(sn(undefined), "index.html", "缺参数回落首页");
  eq(sn("//evil.com/x"), "index.html", "协议相对地址（//外站）被拒");
  eq(sn("https://evil.com/x"), "index.html", "绝对外站地址被拒");
  eq(sn("http://x.test/x"), "index.html", "换了协议（http≠https）的地址被拒");
  eq(sn("https://x.test/t1-p4.html"), "https://x.test/t1-p4.html", "同源完整地址放行（反正是同一个站）");
  eq(sn("javascript:alert(1)"), "index.html", "javascript: 被拒");
  eq(sn("data:text/html,<script>x</script>"), "index.html", "data: 被拒");
  eq(sn("ftp://x.test/a"), "index.html", "非 http(s) 协议被拒");
  eq(sn("/t1-p4.html#frag"), "/t1-p4.html#frag", "带锚点放行");
}

/* ============================================================
   6. 契约：store.js 不依赖引擎
   ============================================================ */
{
  /* 注释里提到不算数，只看真代码 —— 否则上面那段说明自己就把测试搞红了 */
  const bare = CODE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok(bare.indexOf("PET_CONTENT") < 0, "store.js 的真代码不碰 PET_CONTENT（登录页没有这个全局）");
  ok(CODE.indexOf("pet:theme:v1") >= 0, "主题键名仍是 pet:theme:v1（<head> 内联脚本按这个名字读）");
}

/* ============================================================
   结果
   ============================================================ */
console.log("");
if (nFail) {
  console.error("✗ store.js 单测失败 " + nFail + " 条：");
  failures.forEach(f => console.error("    · " + f));
  console.error("\n  通过 " + nPass + " 条");
  process.exit(1);
}
console.log("✓ store.js 单测通过：" + nPass + " 条断言");
