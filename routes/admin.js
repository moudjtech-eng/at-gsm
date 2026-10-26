const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
// On importe les fonctions d'email
const { sendReminderEmail } = require('../utils/mailer'); 

const upload = multer({
  dest: 'public/uploads/',
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  }
});

const MONTHLY_FEE = 500;
const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function seedPendingContributions(memberId, months) {
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    db.prepare("INSERT INTO contributions (member_id, month, year, amount, status) VALUES (?, ?, ?, ?, 'pending')")
      .run(memberId, MONTH_NAMES[d.getMonth()], d.getFullYear(), MONTHLY_FEE);
  }
}

router.use(requireAdmin);

// --- DASHBOARD ADMIN ---
router.get('/', (req, res) => {
  const stats = {
    totalMembers: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'member'").get().c,
    totalPending: db.prepare("SELECT COUNT(*) as c FROM payment_requests WHERE status = 'pending'").get().c,
    totalApplications: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'pending'").get().c,
    totalNews: db.prepare("SELECT COUNT(*) as c FROM news").get().c
  };
  res.render('admin/dashboard', { title: 'Admin', stats });
});

// --- PAGE FINANCES ---
router.get('/finances', (req, res) => {
  const revenueThisMonth = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM payment_requests 
    WHERE status = 'validated' 
    AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get().total;

  const totalRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM payment_requests 
    WHERE status = 'validated'
  `).get().total;

  const totalDebt = db.prepare(`
    SELECT COALESCE(SUM(debt_months * 500), 0) as total 
    FROM members 
    WHERE debt_months > 0
  `).get().total;

  // Requête pour la liste des mauvais payeurs (avec leur ID)
  const debtors = db.prepare(`
    SELECT m.id, m.name, m.phone, m.debt_months, u.email 
    FROM members m 
    JOIN users u ON m.user_id = u.id 
    WHERE m.debt_months > 0 
    ORDER BY m.debt_months DESC
  `).all();

  res.render('admin/finances', { 
    title: 'Finances', 
    revenueThisMonth, 
    totalRevenue, 
    totalDebt, 
    debtors 
  });
});

// --- ENVOYER UNE RELANCE PAR EMAIL ---
router.post('/finances/remind/:memberId', async (req, res) => {
  const member = db.prepare(`
    SELECT m.*, u.email 
    FROM members m 
    JOIN users u ON m.user_id = u.id 
    WHERE m.id = ?
  `).get(req.params.memberId);

  if (!member || member.debt_months <= 0) {
    req.flash('error', 'Ce membre est déjà à jour.');
    return res.redirect('/admin/finances');
  }

  const amount = member.debt_months * 500;
  const success = await sendReminderEmail(member.email, member.name, member.debt_months, amount);

  if (success) {
    req.flash('success', `Relance envoyée à ${member.name} (${member.email})`);
  } else {
    req.flash('error', `Erreur lors de l'envoi de l'email à ${member.name}`);
  }

  res.redirect('/admin/finances');
});

// --- GESTION DES MEMBRES ---
router.get('/members', (req, res) => {
  const members = db.prepare(`
    SELECT u.id as user_id, u.email, u.status as user_status, u.role,
           m.id as member_id, m.name, m.phone, m.spec, m.debt_months
    FROM users u LEFT JOIN members m ON m.user_id = u.id
    ORDER BY u.role DESC, m.name ASC
  `).all();
  res.render('admin/members', { title: 'Membres', members });
});

router.post('/members', (req, res) => {
  const { name, phone, email, password, debt, role } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!name || !phone || !cleanEmail || !password || password.length < 6) {
    req.flash('error', 'Champs requis, mot de passe ≥ 6 caractères.');
    return res.redirect('/admin/members');
  }
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(cleanEmail)) {
    req.flash('error', 'Email déjà utilisé.');
    return res.redirect('/admin/members');
  }

  const userRole = role === 'admin' ? 'admin' : 'member';
  const hash = bcrypt.hashSync(password, 12);
  const u = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)").run(cleanEmail, hash, userRole);
  
  if (userRole === 'member') {
    const m = db.prepare("INSERT INTO members (user_id, name, phone, spec, debt_months) VALUES (?, ?, ?, 'À définir', ?)")
      .run(u.lastInsertRowid, name, phone, parseInt(debt) || 0);
    if (parseInt(debt) > 0) seedPendingContributions(m.lastInsertRowid, parseInt(debt));
  }

  req.flash('success', `${userRole === 'admin' ? 'Admin' : 'Membre'} ${name} créé — Identifiants : ${cleanEmail} / ${password}`);
  res.redirect('/admin/members');
});

router.post('/members/:id', (req, res) => {
  const { name, phone, spec, email } = req.body;
  const member = db.prepare("SELECT * FROM members WHERE id = ?").get(req.params.id);
  if (!member) { req.flash('error', 'Introuvable.'); return res.redirect('/admin/members'); }

  const cleanEmail = (email || '').trim().toLowerCase();
  const currentUser = db.prepare("SELECT email FROM users WHERE id = ?").get(member.user_id);
  if (cleanEmail && cleanEmail !== currentUser.email) {
    if (db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(cleanEmail, member.user_id)) {
      req.flash('error', 'Email déjà utilisé.');
      return res.redirect('/admin/members');
    }
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(cleanEmail, member.user_id);
  }
  db.prepare("UPDATE members SET name = ?, phone = ?, spec = ? WHERE id = ?").run(name, phone, spec, member.id);
  req.flash('success', 'Membre mis à jour.');
  res.redirect('/admin/members');
});

router.post('/users/:id/password', (req, res) => {
  const { password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user || !password || password.length < 6) {
    req.flash('error', 'Mot de passe invalide (min. 6).');
    return res.redirect('/admin/members');
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 12), user.id);
  req.flash('success', `MDP réinitialisé.`);
  res.redirect('/admin/members');
});

router.post('/users/:id/toggle', (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.redirect('/admin/members');
  const newStatus = user.status === 'actif' ? 'suspendu' : 'actif';
  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(newStatus, user.id);
  req.flash('success', `Statut mis à jour.`);
  res.redirect('/admin/members');
});

router.post('/members/:id/debt', (req, res) => {
  const debt = parseInt(req.body.debt) || 0; 
  db.prepare("UPDATE members SET debt_months = ? WHERE id = ?").run(debt, req.params.id);
  req.flash('success', 'Dette mise à jour.');
  res.redirect('/admin/members');
});

// --- GESTION DES PAIEMENTS ---
router.get('/payments', (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, m.name as member_name FROM payment_requests p
    JOIN members m ON m.id = p.member_id
    ORDER BY p.created_at DESC
  `).all();
  res.render('admin/payments', { title: 'Paiements', payments });
});

router.post('/payments/:id/validate', (req, res) => {
  const payment = db.prepare("SELECT * FROM payment_requests WHERE id = ?").get(req.params.id);
  if (!payment || payment.status !== 'pending') {
    req.flash('error', 'Paiement introuvable ou déjà traité.');
    return res.redirect('/admin/payments');
  }
  const member = db.prepare("SELECT * FROM members WHERE id = ?").get(payment.member_id);
  
  const newDebt = member.debt_months - payment.months;
  db.prepare("UPDATE members SET debt_months = ? WHERE id = ?").run(newDebt, member.id);
  db.prepare("UPDATE payment_requests SET status = 'validated' WHERE id = ?").run(payment.id);

  const today = new Date().toISOString().slice(0, 10);
  let remaining = payment.months;
  
  const pending = db.prepare("SELECT * FROM contributions WHERE member_id = ? AND status = 'pending' ORDER BY year DESC, id DESC LIMIT ?")
    .all(member.id, remaining);
  for (const c of pending) {
    db.prepare("UPDATE contributions SET status = 'paid', paid_at = ? WHERE id = ?").run(today, c.id);
    remaining--;
  }

  if (remaining > 0) {
    let lastRecord = db.prepare("SELECT year, month FROM contributions WHERE member_id = ? ORDER BY year DESC, id DESC LIMIT 1").get(member.id);
    let futureDate = new Date();
    if (lastRecord) {
      const monthIdx = MONTH_NAMES.indexOf(lastRecord.month);
      if (monthIdx !== -1) futureDate = new Date(lastRecord.year, monthIdx, 1);
    }
    for (let i = 0; i < remaining; i++) {
      futureDate.setMonth(futureDate.getMonth() + 1);
      db.prepare("INSERT INTO contributions (member_id, month, year, amount, status, paid_at) VALUES (?, ?, ?, ?, 'paid', ?)")
        .run(member.id, MONTH_NAMES[futureDate.getMonth()], futureDate.getFullYear(), MONTHLY_FEE, today);
    }
  }

  req.flash('success', `Paiement de ${member.name} validé.`);
  res.redirect('/admin/payments');
});

router.post('/payments/:id/reject', (req, res) => {
  db.prepare("UPDATE payment_requests SET status = 'rejected' WHERE id = ?").run(req.params.id);
  req.flash('info', 'Paiement rejeté.');
  res.redirect('/admin/payments');
});

// --- GESTION DES CANDIDATURES ---
router.get('/applications', (req, res) => {
  const applications = db.prepare("SELECT * FROM applications ORDER BY created_at DESC").all();
  res.render('admin/applications', { title: 'Candidatures', applications });
});

router.post('/applications/:id/accept', (req, res) => {
  const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id);
  if (!app) { req.flash('error', 'Introuvable.'); return res.redirect('/admin/applications'); }

  const password = 'AT' + Math.random().toString(36).slice(-6).toUpperCase();
  try {
    const u = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'member')")
      .run(app.email, bcrypt.hashSync(password, 12));
    db.prepare("INSERT INTO members (user_id, name, phone, spec) VALUES (?, ?, ?, ?)")
      .run(u.lastInsertRowid, app.name, app.phone, app.spec);
    db.prepare("UPDATE applications SET status = 'accepted' WHERE id = ?").run(app.id);
    req.flash('success', `Membre créé. Email: ${app.email} / Mot de passe: ${password}`);
  } catch (e) {
    req.flash('error', 'Email déjà utilisé.');
  }
  res.redirect('/admin/applications');
});

router.post('/applications/:id/reject', (req, res) => {
  db.prepare("UPDATE applications SET status = 'rejected' WHERE id = ?").run(req.params.id);
  req.flash('info', 'Candidature rejetée.');
  res.redirect('/admin/applications');
});

// --- GESTION DES NEWS ---
router.get('/news', (req, res) => {
  const news = db.prepare("SELECT * FROM news ORDER BY created_at DESC").all();
  res.render('admin/news', { title: 'News', news });
});

router.post('/news', upload.single('image'), (req, res) => {
  const { title, category, content } = req.body;
  if (!title || !category || !content) {
    req.flash('error', 'Tous les champs sont requis.');
    return res.redirect('/admin/news');
  }
  db.prepare("INSERT INTO news (title, category, content, image_path) VALUES (?, ?, ?, ?)")
    .run(title, category, content, req.file ? req.file.filename : null);
  req.flash('success', 'Annonce publiée.');
  res.redirect('/admin/news');
});

router.post('/news/:id/delete', (req, res) => {
  db.prepare("DELETE FROM news WHERE id = ?").run(req.params.id);
  req.flash('info', 'Annonce supprimée.');
  res.redirect('/admin/news');
});

// --- VOIR UN REÇU (Côté Admin) ---
router.get('/receipt/:ref', (req, res) => {
  const payment = db.prepare(`
    SELECT p.*, m.name, m.spec, m.phone 
    FROM payment_requests p 
    JOIN members m ON p.member_id = m.id 
    WHERE p.ref = ?
  `).get(req.params.ref);

  if (!payment) return res.status(404).send('Reçu introuvable');

  const member = {
    name: payment.name,
    spec: payment.spec,
    phone: payment.phone
  };

  res.render('member/receipt', { payment, member, MONTHLY_FEE: 500 });
});

module.exports = router;