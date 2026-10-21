const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/fyip.db");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const out = [];
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(t.name).replace(/"/g, '')})`).all();
  const fixtureCol = cols.find((c) => c.name === "is_fixture");
  if (fixtureCol) {
    const before = db.prepare(`SELECT COUNT(*) AS c FROM ${t.name}`).get().c;
    db.prepare(`DELETE FROM ${t.name} WHERE is_fixture = 1`).run();
    const after = db.prepare(`SELECT COUNT(*) AS c FROM ${t.name}`).get().c;
    out.push(`${t.name}: ${before} -> ${after}`);
  }
}
console.log(out.join("\n") || "no fixture tables found");
db.close();
