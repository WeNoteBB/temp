const fs=require("fs");
const buf=fs.readFileSync("C:\\Users\\89300\\Desktop\\校内\\六上英语笔记\\六上英语笔记_1-9.pdf");
const s=buf.toString("latin1");
console.log("Image XObjects:", (s.match(/\/Subtype\s*\/Image/g)||[]).length);
console.log("Font objs:", (s.match(/\/Subtype\s*\/Font/g)||[]).length);
console.log("FlateDecode:", (s.match(/FlateDecode/g)||[]).length);
