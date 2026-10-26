const db = require('./database');
const bcrypt = require('bcryptjs');

const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const MONTHLY_FEE = 500;

function seedPendingContributions(memberId, debtMonths) {
  const now = new Date();
  for (let i = 0; i < debtMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    db.prepare("INSERT INTO contributions (member_id, month, year, amount, status) VALUES (?, ?, ?, ?, 'pending')")
      .run(memberId, MONTH_NAMES[d.getMonth()], d.getFullYear(), MONTHLY_FEE);
  }
}

function init() {
  db.exec(`
        CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'actif',
      reset_token TEXT,
      reset_token_expires INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      spec TEXT,
      skills TEXT,
      url TEXT,
      bio TEXT,
      photo_path TEXT,
      debt_months INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      year INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      months INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      ref TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      spec TEXT NOT NULL,
      docs_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      image_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Admin
  if (!db.prepare("SELECT id FROM users WHERE email = ?").get('admin@atgsm.bj')) {
    const hash = bcrypt.hashSync('admin2026', 12);
    const r = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')").run('admin@atgsm.bj', hash);
    db.prepare("INSERT INTO members (user_id, name, spec) VALUES (?, 'Administrateur', 'Admin')").run(r.lastInsertRowid);
    console.log('✅ Admin : admin@atgsm.bj / admin2026');
  }

  // Membres démo
  const demoMembers = [
    { email: 'jean@atgsm.bj', password: 'jean123', name: 'Jean Dupont', phone: '+229 90 00 00 00', spec: 'Spécialiste Matériel Senior', skills: 'iPhone, Samsung, Micro-soudure', url: 'https://jeantech.bj', bio: "Expert en réparations de cartes complexes avec 10 ans d'expérience.", debt: 3 },
    { email: 'marie@atgsm.bj', password: 'marie123', name: 'Marie Kouassi', phone: '+229 91 00 00 00', spec: 'Experte Logicielle', skills: 'Android, iOS, Déblocage', url: 'https://mariesoft.bj', bio: "Spécialiste en récupération d'OS.", debt: 1 },
    { email: 'koffi@atgsm.bj', password: 'koffi123', name: 'Koffi Mensah', phone: '+229 92 00 00 00', spec: 'Technicien Généraliste', skills: 'Écrans, Batterie, Charge', url: '', bio: 'Remplacement rapide de pièces.', debt: 0 },
  ];
  for (const dm of demoMembers) {
    if (!db.prepare("SELECT id FROM users WHERE email = ?").get(dm.email)) {
      const hash = bcrypt.hashSync(dm.password, 12);
      const u = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'member')").run(dm.email, hash);
      const m = db.prepare("INSERT INTO members (user_id, name, phone, spec, skills, url, bio, debt_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(u.lastInsertRowid, dm.name, dm.phone, dm.spec, dm.skills, dm.url, dm.bio, dm.debt);
      if (dm.debt > 0) seedPendingContributions(m.lastInsertRowid, dm.debt);
      console.log(`✅ Membre : ${dm.email} / ${dm.password}`);
    }
  }

  // News
  if (db.prepare("SELECT COUNT(*) as c FROM news").get().c === 0) {
    const ins = db.prepare("INSERT INTO news (title, category, content) VALUES (?, ?, ?)");
    ins.run('Atelier Infrastructure 5G', 'Formation', 'Session de formation complète sur les normes 5G.');
    ins.run('Nouveau Centre de Diagnostic', 'Investissement', "Acquisition d'équipements de diagnostic de pointe.");
    ins.run('Assemblée Générale Annuelle', 'Communauté', 'Revue de la croissance et planification.');
  }

  console.log('✅ Base de données initialisée : db/atgsm.db');
}

init();