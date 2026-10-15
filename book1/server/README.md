# PET 精读 · 发信服务

把页面上的历史记录（单词 / 词组 / 句子）整理成 Word 文档，发到你的邮箱。

## 它做什么

一台很小的 Node 服务，干两件事：

1. **托管那个 HTML** —— 页面和接口同源，于是 CORS、混合内容、预检全都不存在
2. **POST /api/send** —— 收下内容，用 SMTP 发出去

```
浏览器打开  http://<IP>:8787/
      │  POST /api/send   （同源）
      ▼
  这个服务（nodemailer + SMTP）
      │
      ▼
   你的邮箱
```

**为什么不做成"直接双击 HTML 就能发"**：静态页面没有发信能力，把 SMTP 授权码放进 HTML 等于谁拿到文件谁就能用你的邮箱发信。所以凭据留在服务器的 `config.json` 里，**HTML 里一个密钥都没有**。

---

## 一、准备

去你的邮箱设置里开 SMTP，拿一个**授权码**（不是你登录邮箱的密码）。

| 邮箱 | 怎么开 |
|---|---|
| QQ 邮箱 | 设置 → 账户 → 开启 SMTP 服务 → 生成授权码 |
| 163 邮箱 | 设置 → POP3/SMTP/IMAP → 开启 → 新增授权码 |
| Gmail | 开两步验证 → 生成「应用专用密码」 |
| Outlook | 直接可用，但端口填 587、`secure` 填 `false` |
| 企业邮箱 | 问公司 IT 要 SMTP 地址和端口 |

## 二、配置

```bash
cd server
cp config.example.json config.json
vim config.json          # 改 host / user / pass / to
```

`config.json` 最少要填这几项：

```json
{
  "host": "smtp.qq.com",
  "smtpPort": 465,
  "secure": true,
  "user": "你的邮箱@qq.com",
  "pass": "授权码",
  "to": "收件邮箱，可以就是你自己"
}
```

- **`secure`**：端口 465 填 `true`，587 填 `false`
- **`token`**（可选）：留空就不校验口令。填了之后页面必须从这台服务器打开才发得出去——**建议填**，否则任何人访问你的 `IP:端口` 都能调它往你邮箱发信

## 三、装依赖并启动

```bash
npm install
node mail-server.cjs
```

启动时会打印配置摘要，并**先测一次 SMTP 连接**——配置错了当场就能看到，不用等你点发送才发现。

```
PET 精读 · 发信服务已启动
  监听    http://0.0.0.0:8787/
  SMTP    smtp.qq.com:465 (TLS)
  发件人  xxx@qq.com
  收件人  xxx@qq.com
  口令    已启用
  SMTP 连接测试：通过 ✓
```

## 四、用

浏览器打开 `http://<服务器IP>:8787/`，页面上点几个单词和句子攒点历史，然后点顶栏的 **📧 发送到邮箱**。

**双击本地 HTML 打开时那个按钮是灰的**——这是故意的，页面探测不到发信服务就禁用。文件还是同一个，不影响本地学习。

## 五、后台常驻（可选）

```bash
# 用 pm2
npm i -g pm2
pm2 start mail-server.cjs --name pet-mail
pm2 save && pm2 startup

# 或者用 systemd
```

## 六、排查

服务端会把常见故障翻译成人话，直接看页面上的提示或终端日志：

| 提示 | 多半是 |
|---|---|
| 邮箱认证失败 | 授权码不对。**不是登录密码**，要去邮箱设置里单独生成 |
| 连不上 SMTP 服务器 | 主机名/端口错，或服务器出不了网（有的云主机默认封 25/465 端口） |
| 发件人或收件人被拒 | `from` / `to` 得是这个服务商认可的地址 |
| 口令不对 | 页面不是从这台服务器打开的，或者 `config.json` 里改过 token 后没重启服务 |
| 页面打不开 | 检查防火墙 / 安全组有没有放行 8787 端口 |

## 七、安全须知

- **`config.json` 里有授权码，别提交到 git、别发给别人**（仓库的 `.gitignore` 已经排除它了）
- 建议在 `config.json` 里填一个 `token`，避免别人扫到你的端口就能往你邮箱发信
- 服务只做发信，不读任何文件、不执行任何命令，收到的内容只用来拼邮件
- 页面侧限制：只接受 `subject` / `filename` / `content` 三个字段，请求体上限 20MB

## 八、接口

给想自己改的人：

```
GET  /api/health
     → {"ok":true,"needToken":true,"to":"x***@qq.com"}
     页面靠它判断"我是不是被托管的"，据此决定发送按钮能不能点

POST /api/send
     {"token":"…","subject":"…","filename":"…","content":"<base64>","body":"…"}
     → {"ok":true,"messageId":"…"}  或  {"error":"人话版的错误说明"}
```
