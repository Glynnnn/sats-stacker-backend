// db.js
import Database from "better-sqlite3";
import path from "path";

// Save DB file to disk in project root
const db = new Database(path.resolve(__dirname, "addresses.db"));

// Create table if not exists
db.prepare(
  `
    CREATE TABLE IF NOT EXISTS btc_price_cache (
      date TEXT PRIMARY KEY,
      price_data TEXT,
      timestamp INTEGER
    )
  `
).run();

export default db;
