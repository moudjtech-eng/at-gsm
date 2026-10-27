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
  // Création des tables initiales
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'actif',
      reset_token TEXT,
      reset_token_expires INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      spec TEXT,
      skills TEXT,
      url TEXT,
      bio TEXT,
      location TEXT,
      latitude REAL,
      longitude REAL,
      photo_path TEXT,
      debt_months INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      year INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      months INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      ref TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      spec TEXT NOT NULL,
      docs_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      image_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ==========================================
  // MIGRATION : Ajout automatique des nouvelles colonnes si elles n'existent pas
  // ==========================================
  try {
    const tableInfo = await db.execute("PRAGMA table_info(members)");
    const columns = tableInfo.rows.map(c => c.name);

    if (!columns.includes('location')) {
      await db.execute("ALTER TABLE members ADD COLUMN location TEXT");
      console.log("✅ Colonne 'location' ajoutée à la base de données.");
    }
    if (!columns.includes('latitude')) {
      await db.execute("ALTER TABLE members ADD COLUMN latitude REAL");
      console.log("✅ Colonne 'latitude' ajoutée à la base de données.");
    }
    if (!columns.includes('longitude')) {
      await db.execute("ALTER TABLE members ADD COLUMN longitude REAL");
      console.log("✅ Colonne 'longitude' ajoutée à la base de données.");
    }
  } catch (migrationError) {
    console.error("Erreur lors de la migration de la base de données:", migrationError);
  }

  // Admin par défaut
  const adminCheck = await db.execute("SELECT id FROM users WHERE email = 'admin@atgsm.bj'");
  if (adminCheck.rows.length === 0) {
    const hash = bcrypt.hashSync('admin2026', 12);
    const r = await db.execute({
      sql: "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')",
      args: ['admin@atgsm.bj', hash]
    });
    await db.execute({
      sql: "INSERT INTO members (user_id, name, spec) VALUES (?, 'Administrateur', 'Admin')",
      args: [Number(r.lastInsertRowid)]
    });
    console.log('✅ Admin : admin@atgsm.bj / admin2026');
  }

  // Membres démo
  const demoMembers = [
    { email: 'jean@atgsm.bj', password: 'jean123', name: 'Jean Dupont', phone: '+229 90 00 00 00', spec: 'Spécialiste Matériel Senior', skills: 'iPhone, Samsung, Micro-soudure', url: 'https://jeantech.bj', bio: "Expert en réparations de cartes complexes avec 10 ans d'expérience.", debt: 3 },
    { email: 'marie@atgsm.bj', password: 'marie123', name: 'Marie Kouassi', phone: '+229 91 00 00 00', spec: 'Experte Logicielle', skills: 'Android, iOS, Déblocage', url: 'https://mariesoft.bj', bio: "Spécialiste en récupération d'OS.", debt: 1 },
    { email: 'koffi@atgsm.bj', password: 'koffi123', name: 'Koffi Mensah', phone: '+229 92 00 00 00', spec: 'Technicien Généraliste', skills: 'Écrans, Batterie, Charge', url: '', bio: 'Remplacement rapide de pièces.', debt: 0 },
  ];

  for (const dm of demoMembers) {
    const memberCheck = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [dm.email] });
    if (memberCheck.rows.length === 0) {
      const hash = bcrypt.hashSync(dm.password, 12);
      const u = await db.execute({
        sql: "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'member')",
        args: [dm.email, hash]
      });
      const m = await db.execute({
        sql: "INSERT INTO members (user_id, name, phone, spec, skills, url, bio, debt_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [Number(u.lastInsertRowid), dm.name, dm.phone, dm.spec, dm.skills, dm.url, dm.bio, dm.debt]
      });
      if (dm.debt > 0) await seedPendingContributions(Number(m.lastInsertRowid), dm.debt);
      console.log(`✅ Membre : ${dm.email} / ${dm.password}`);
    }
  }

  // News
  const newsCheck = await db.execute("SELECT COUNT(*) as c FROM news");
  if (newsCheck.rows[0].c === 0) {
    await db.execute({ sql: "INSERT INTO news (title, category, content) VALUES (?, ?, ?)", args: ['Atelier Infrastructure 5G', 'Formation', 'Session de formation complète sur les normes 5G.'] });
    await db.execute({ sql: "INSERT INTO news (title, category, content) VALUES (?, ?, ?)", args: ['Nouveau Centre de Diagnostic', 'Investissement', "Acquisition d'équipements de diagnostic de pointe."] });
    await db.execute({ sql: "INSERT INTO news (title, category, content) VALUES (?, ?, ?)", args: ['Assemblée Générale Annuelle', 'Communauté', 'Revue de la croissance et planification.'] });
  }

  console.log('✅ Base de données initialisée et à jour');
}

init().catch(console.error);