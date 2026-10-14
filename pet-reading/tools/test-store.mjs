/* store.js 的单元测试
   用法： node tools/test-store.mjs

   为什么单独测它：store.js 是将来接后端时**唯一要动的文件**。
   它现在包的是 localStorage，但每个接口都写成 async，就是为了那天
   页面代码一行不改。这个测试锁的是「接口的语义」，不是「它现在用 localStorage」。

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
    console
  };

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
   2. 登录态
   ============================================================ */
{
  const s = fresh();
  eq(await s.getUser(), null, "没登录过时 getUser() 是 null");

  const bad = await s.login("1380013800");     // 10 位
  ok(bad.ok === false, "10 位手机号被拒");
  const bad2 = await s.login("12800138000");   // 第二位不是 3-9
  ok(bad2.ok === false, "1[^3-9] 开头的手机号被拒");
  eq(await s.getUser(), null, "校验失败不留痕迹");
  const bad3 = await s.login("138 0013 8000"); // 带空格：应当先被清掉再判
  ok(bad3.ok === true, "带空格的合法手机号能通过（先清洗再校验）");

  const good = await s.login("13800138000");
  ok(good.ok === true && good.persisted === true, "合法手机号登录成功且落盘");

  const u = await s.getUser();
  eq(u && u.phone, "13800138000", "getUser() 拿回手机号");
  ok(typeof (u && u.ts) === "number", "登录态带时间戳");

  eq(s.maskPhone("13800138000"), "138****8000", "脱敏格式 138****8000");
  eq(s.maskPhone(""), "", "空串脱敏不炸");

  /* 存不住时也必须 ok —— 否则用户被卡在登录页出不去（见 guard 那节） */
  const broken = fresh({ lsBroken: "access" });
  const r = await broken.login("13800138000");
  ok(r.ok === true && r.persisted === false, "存储不可用时登录仍返回 ok，但如实说明没落盘");

  await s.logout();
  eq(await s.getUser(), null, "logout() 之后 getUser() 回到 null");
}

/* ============================================================
   3. 收藏：按词全局、按句分篇，且能取消
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

  /* 句子按篇：ref 只在它自己那篇里有意义 */
  await s.addFav({ type: "s", ref: "0-1", slug: "t1-p4" });
  await s.addFav({ type: "s", ref: "0-1", slug: "t9-p2" });
  eq((await s.listFav()).length, 2, "同 ref 不同篇的句子是两条");
  ok(await s.isFav("s:t1-p4@0-1"), "句子 id 带上 slug");
  ok(await s.isFav("s:t9-p2@0-1"), "另一篇的同 ref 独立");

  eq(s.favId({ type: "w", key: "run" }), "w:run", "单词 id");
  eq(s.favId({ type: "s", ref: "2-3", slug: "a" }), "s:a@2-3", "句子 id");

  const bad = await s.addFav({ type: "w" });
  ok(bad.ok === false, "没有 key 的收藏被拒，不写空条目");

  /* 存储坏掉时：行为要一致（能点亮也能取消），但如实说没落盘 */
  const b = fresh({ lsBroken: "write" });
  const b1 = await b.addFav({ type: "w", key: "run" });
  const b2 = await b.addFav({ type: "w", key: "run" });
  ok(b1.added === true && b2.added === false, "存储不可用时，收藏仍能点亮 / 取消");
  ok(b1.persisted === false, "存储不可用时 persisted 为 false");
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
  /* 未登录 + 存储可用 → 跳登录页，next 带上原路径 */
  const { store: s, win } = makeSandbox();
  const v1 = await s.guard();
  eq(v1, "denied", "未登录时 guard 返回 denied");
  ok(win.location.replaced === "login.html?next=%2Ft1-p4.html",
    "跳到 login.html 并带回跳地址（实际 " + win.location.replaced + "）");
  ok(win.location.replaced.indexOf("http") !== 0, "回跳地址是站内相对路径，不是完整 URL");

  /* 已登录 → 放行 */
  const logged = makeSandbox({ seed: [["pet:user:v1", j({ phone: "13800138000", ts: 1 })]] });
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
