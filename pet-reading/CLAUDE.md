# PET 精读 · 工程约定

给接手这个仓库的 Claude 看的。用户是中文使用者，**回复和注释一律用中文**。

**先读 `README.md`** —— 那里是完整文档（字段表、部署配置、硬规矩、人工检查清单）。
本文件只讲「接手时最容易踩错的地方」。

## 这是什么

**引擎与内容分离**的静态精读站。引擎全站共用，每篇文章只产出一个 JSON。
目前 1 篇，目标是 200+ 篇。部署在 2 核 2G 的 nginx 上，纯静态，无 Node 进程。

## 命令

```bash
npm run check              # verify → build → smoke → test-store，提交前必跑
node build.mjs --only <slug>   # 只重建一篇
node tools/verify.mjs <slug>   # 单篇内容自检
node tools/new.mjs sources/x.txt --slug t1-p3-xxx   # 新文章骨架
node tools/promote.mjs --write # 重复词条上浮到共享词库
```

改任何东西之后 `npm run check` 必须全绿。当前基线：**verify ✓ / smoke 193 / test-store 72**。

## 架构要点

- `engine/*.js|css` 是**扫描**进构建的，不是写死名单。丢个新文件进去会自动带上 `?v=` 版本号。
- 模板里用 `<!--V:文件名-->` 引用版本号，`<!--THEME_HEAD-->` 注入防闪烁脚本。
- **`build.mjs` 的 `PAGES` 注册表**管 `dist/` 顶层所有固定页面。加新页面往这里加一条，
  别往孤儿清理循环里堆 `if (f === "xxx.html")` 特例。
- **`engine/store.js` 是唯一的数据层**（登录态 / 收藏 / 主题），全部 `async`。
  接后端时**只改这个文件**，页面代码一行不动 —— 这是当初「预留后端」的全部设计。
- `guard()` 是门禁本体，**存储不可用时必须放行**，否则 `file://` 和隐私模式会变成无限跳转死循环。

## 改代码前必读：README 的「硬规矩」

那 8 条全是踩过的坑，每条都对应一个构建期检查。最容易犯的三个：

1. **分词正则三处必须逐字一致** —— `engine/app.js`、`tools/verify.mjs`、`tools/new.mjs`。
2. **`String.replace` 的替换值传函数，且必须全局替换**。`.replace("<!--X-->", v)` 只替第一处，
   第二处会静默消失（构建、校验、冒烟全绿，只是内容没了）。
3. **颜色一律走语义令牌**，暗色只覆写 `:root[data-theme="dark"]` 里的令牌。
   在 `:root` 之外写 `#fff` 的地方，暗色主题下就是一块白斑。

## jsdom 测不到的东西（改样式后必须人工过一遍）

`tools/smoke.mjs` 用 jsdom，它有两条硬限制：**没有 `matchMedia`**，
且 **`getComputedStyle` 完全忽略 `@media` 规则**。

所以下面这些只能人眼看，README 末尾有完整清单：

- 底部抽屉（`<1100px` 时小黑板变成从底部升起的抽屉）的升起/收起动画
- 亮暗两套配色的实际观感
- 触摸设备上靠 `@media(hover:none)` 常显的按钮（`.hfav` / `.hdel`）
- 页边按钮在 `≥1100px` 下是否精确对齐（量法见 README，**别拿 `.sent` 的右边缘去减**，
  它是 `display:inline`，段末短句量出来是假间隙）

一个带登录态的量法：起 `python3 -m http.server 8899` 在 `dist/`，
浏览器里 `localStorage.setItem("pet:user:v1", JSON.stringify({phone:"13800138000",ts:1}))`。

## 当前状态（2026-10-15）

四条需求已全部完成并验证：**三端适配 / 暗色模式 / 登录页+强制门禁 / 收藏按钮**。

已验证：7 个宽度（375 / 768 / 1024 / 1099 / 1100 / 1194 / 1280 / 1400）逐档实测无横向溢出、
断点两侧布局正确、旋转屏幕状态正确、登录→文章→脱敏手机号全链路通。

**未做 / 待办：**

- **整个 `pet-reading/` 还没提交过 git**（仓库根是上层目录，`main` 上的提交都是旧的 `book1`）。
- **收藏只做了前端**：`addFav`/`isFav` 现在写 `localStorage` 的 `pet:fav:v1`，
  真实数据库表还没接。接口已经留好，改 `store.js` 即可。
- 门禁是**软门禁**（纯客户端，懂技术的人能绕过）。它现在的目的是收集手机号，不是防人。
