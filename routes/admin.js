const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { sendReminderEmail } = require('../utils/mailer'); 

const upload = multer({ dest: 'public/uploads/', limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => { cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)); } });
const MONTHLY_FEE = 500;
const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

async function seedPendingContributions(memberId, months) {
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    await db.execute({ sql: "INSERT INTO contributions (member_id, month, year, amount, status) VALUES (?, ?, ?, ?, 'pending')", args: [memberId, MONTH_NAMES[d.getMonth()], d.getFullYear(), MONTHLY_FEE] });
  }
}

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const { rows: m } = await db.execute("SELECT COUNT(*) as c FROM users WHERE role = 'member'");
  const { rows: v } = await db.execute("SELECT COUNT(*) as c FROM payment_requests WHERE status = 'validated'");
  const { rows: a } = await db.execute("SELECT COUNT(*) as c FROM applications WHERE status = 'pending'");
  const { rows: n } = await db.execute("SELECT COUNT(*) as c FROM news");
  res.render('admin/dashboard', { title: 'Admin', stats: { totalMembers: m[0].c, totalValidated: v[0].c, totalApplications: a[0].c, totalNews: n[0].c } });
});

// --- PAGE FINANCES ---
router.get('/finances', async (req, res) => {
  try {
    // 1. Revenus (Cotisations validées + Adhésions payées)
    const { rows: r1 } = await db.execute(`SELECT COALESCE(SUM(amount), 0) as total FROM payment_requests WHERE status = 'validated'`);
    const { rows: r2 } = await db.execute(`SELECT COALESCE(SUM(adhesion_fee), 0) as total FROM applications WHERE transaction_ref IS NOT NULL`);
    const totalRevenue = Number(r1[0].total) + Number(r2[0].total);
    
    // 2. Dépenses
    const { rows: d1 } = await db.execute(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses`);
    const totalExpenses = Number(d1[0].total);
    const { rows: expenses } = await db.execute(`SELECT * FROM expenses ORDER BY created_at DESC`);

    // 3. Solde Initial
    const { rows: s1 } = await db.execute("SELECT value FROM settings WHERE key = 'initial_balance'");
    const initialBalance = s1.length > 0 ? Number(s1[0].value) : 0;

    // 4. Solde Actuel
    const currentBalance = initialBalance + totalRevenue - totalExpenses;

    // 5. Dettes
    const { rows: r5 } = await db.execute(`SELECT COALESCE(SUM(debt_months * 500), 0) as total FROM members WHERE debt_months > 0`);
    const { rows: debtors } = await db.execute(`SELECT m.id, m.name, m.phone, m.debt_months, u.email FROM members m JOIN users u ON m.user_id = u.id WHERE m.debt_months > 0 ORDER BY m.debt_months DESC`);

    res.render('admin/finances', { 
      title: 'Finances', 
      totalRevenue, 
      totalExpenses, 
      currentBalance,
      initialBalance,
      expenses,
      totalDebt: Number(r5[0].total), 
      debtors 
    });
  } catch (err) {
    console.error("Erreur finances:", err);
    res.redirect('/admin');
  }
});

// --- DÉFINIR LE SOLDE INITIAL ---
router.post('/finances/initial-balance', async (req, res) => {
  const { amount } = req.body;
  await db.execute({ sql: "UPDATE settings SET value = ? WHERE key = 'initial_balance'", args: [amount] });
  req.flash('success', 'Solde initial mis à jour.');
  res.redirect('/admin/finances');
});

// --- EFFECTUER UN RETRAIT (PROCÉDURE STRICTE) ---
router.post('/finances/withdraw', async (req, res) => {
  const { amount, reason, npi, cip_expiry, secret_key } = req.body;
  
  // 1. Vérification de la clé privée (Seul le TG l'a)
  if (secret_key !== process.env.TREASURER_KEY) {
    req.flash('error', 'Clé privée de retrait incorrecte. Action refusée.');
    return res.redirect('/admin/finances');
  }

  // 2. Vérification de la date d'expiration de la CIP
  const today = new Date().toISOString().slice(0, 10);
  if (cip_expiry < today) {
    req.flash('error', 'Impossible de faire un retrait : Votre carte CIP est expirée.');
    return res.redirect('/admin/finances');
  }

  try {
    // 3. Enregistrement de la dépense
    await db.execute({
      sql: "INSERT INTO expenses (amount, reason, npi, cip_expiry) VALUES (?, ?, ?, ?)",
      args: [parseInt(amount), reason, npi, cip_expiry]
    });
    req.flash('success', `Retrait de ${parseInt(amount).toLocaleString('fr-FR')} FCFA effectué avec succès.`);
    res.redirect('/admin/finances');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Erreur lors du retrait.');
    res.redirect('/admin/finances');
  }
});

// ... LE RESTE DES ROUTES ADMIN (membres, paiements, news, etc.) RESTE INCHANGÉ ...
// (Je ne les remets pas ici pour faire court, garde ton code actuel pour la suite du fichier)