const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || process.cwd();
const dbPath = path.join(dataDir, 'database.sqlite');

let db = null;

function saveToFile() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// Wrapper that mimics better-sqlite3 API
const wrapper = {
  prepare(sql) {
    return {
      run(...params) {
        db.run(sql, params);
        saveToFile();
        return { changes: db.getRowsModified() };
      },
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      }
    };
  },
  exec(sql) {
    db.run(sql);
    saveToFile();
  }
};

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      odometer_reading REAL,
      odometer_image_path TEXT,
      earnings REAL DEFAULT 0,
      gas_cost REAL DEFAULT 0,
      gas_receipt_image_path TEXT,
      notes TEXT,
      notion_page_id TEXT,
      personal_miles REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  saveToFile();

  return wrapper;
}

module.exports = { initDb };
