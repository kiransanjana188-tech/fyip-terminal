const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/fyip.db");
db.exec("PRAGMA busy_timeout = 10000");
const tables = ["quote_snapshots", "trade_prints", "depth_snapshots"];
for (const table of tables) {
  const before = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  db.exec(`DELETE FROM ${table} WHERE data_status = 'simulated'`);
  const after = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  console.log(`${table}:`, before, "->", after);
}
db.close();
