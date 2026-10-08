/* 把 permissions.defaultMode 设为 bypassPermissions（保留文件里其它所有设置） */
const fs = require("fs");
const os = require("os");
const path = require("path");

const f = path.join(os.homedir(), ".claude", "settings.json");
const before = JSON.parse(fs.readFileSync(f, "utf8"));   // 先解析，确认原文件合法

before.permissions = before.permissions || {};
const prev = before.permissions.defaultMode;
before.permissions.defaultMode = "bypassPermissions";

fs.writeFileSync(f, JSON.stringify(before, null, 2) + "\n", "utf8");

const after = JSON.parse(fs.readFileSync(f, "utf8"));    // 回读校验
console.log("文件: " + f);
console.log("defaultMode: " + (prev || "(未设置)") + "  →  " + after.permissions.defaultMode);
console.log("JSON 校验: 通过");
console.log("其它键保留: " + Object.keys(after).join(", "));
console.log("permissions 子键: " + Object.keys(after.permissions).join(", "));
console.log("allow 条数: " + (after.permissions.allow || []).length);
