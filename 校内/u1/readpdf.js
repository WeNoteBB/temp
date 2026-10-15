const fs = require("fs");
const pdf = require("pdf-parse");
const buf = fs.readFileSync("C:\\Users\\89300\\Desktop\\校内\\六上英语笔记\\六上英语笔记_1-9.pdf");
pdf(buf).then(d => {
  console.log("PAGES:", d.numpages);
  console.log("===TEXT START===");
  console.log(d.text.slice(0, 4000));
}).catch(e => { console.error("ERR:", e.message); process.exit(1); });
