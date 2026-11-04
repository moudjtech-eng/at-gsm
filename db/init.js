const db = require('./database');
const bcrypt = require('bcryptjs');

const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const MONTHLY_FEE = 500;

async function seedPendingContributions(memberId, debtMonths) {
  const now = new Date();
  for (let i = 0; i < debtMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    await db.execute({
      sql: "INSERT INTO contributions (member_id, month, year, amount, status) VALUES (?, ?, ?, ?, 'pending')",
      args: [memberId, MONTH_NAMES[d.getMonth()], d.getFullYear(), MONTHLY_FEE]
    });
  }
}

async function init() {
  await db.execute(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'actif', reset_token TEXT, reset_token_expires INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT, spec TEXT, skills TEXT, url TEXT, bio TEXT, location TEXT, latitude REAL, longitude REAL, photo_path TEXT, debt_months INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, month TEXT NOT NULL, year INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', paid_at TEXT, FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS payment_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, months INTEGER NOT NULL, amount INTEGER NOT NULL, ref TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE)`);
  
  // Nouvelle table applications avec transaction_ref
  await db.execute(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    name TEXT NOT NULL, 
    email TEXT NOT NULL, 
    phone TEXT NOT NULL, 
    spec TEXT NOT NULL, 
    docs_path TEXT, 
    status TEXT NOT NULL DEFAULT 'pending', 
    member_type TEXT DEFAULT 'existing', 
    trainer_phone TEXT, 
    trainer_is_bohicon INTEGER DEFAULT 0, 
    adhesion_fee INTEGER DEFAULT 0,
    transaction_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  
  await db.execute(`CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, content TEXT NOT NULL, image_path TEXT, author TEXT DEFAULT 'Administrateur', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

  // Migrations
  try {
    const appInfo = await db.execute("PRAGMA table_info(applications)");
    const appCols = appInfo.rows.map(c => c.name);
    if (!appCols.includes('transaction_ref')) await db.execute("ALTER TABLE applications ADD COLUMN transaction_ref TEXT");
  } catch (err) { console.error("Erreur migration:", err); }

  console.log('✅ Base de données prête avec système d\'adhésion et KkiaPay');
}

init().catch(console.error);