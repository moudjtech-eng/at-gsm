const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { sendReminderEmail } = require('../utils/mailer'); 

const upload = multer({
  dest: 'public/uploads/',
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => { cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)); }
});

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

// --- DASHBOARD ADMIN ---
router.get('/', async (req, res) => {
  try {
    const { rows: m } = await db.execute("SELECT COUNT(*) as c FROM users WHERE role = 'member'");
    const { rows: v } = await db.execute("SELECT COUNT(*) as c FROM payment_requests WHERE status = 'validated'");
    const { rows: a } = await db.execute("SELECT COUNT(*) as c FROM applications WHERE status = 'pending'");
    const { rows: n } = await db.execute("SELECT COUNT(*) as c FROM news");
    res.render('admin/dashboard', { title: 'Admin', stats: { totalMembers: m[0].c, totalValidated: v[0].c, totalApplications: a[0].c, totalNews: n[0].c } });
  } catch (err) { console.error(err); res.redirect('/'); }
});

// --- FINANCES ---
router.get('/finances', async (req, res) => {
  try {
    const { rows: r1 } = await db.execute(`SELECT COALESCE(SUM(amount), 0) as total FROM payment_requests WHERE status = 'validated' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`);
    const { rows: r2 } = await db.execute(`SELECT COALESCE(SUM(amount), 0) as total FROM payment_requests WHERE status = 'validated'`);
    const { rows: r3 } = await db.execute(`SELECT COALESCE(SUM(debt_months * 500), 0) as total FROM members WHERE debt_months > 0`);
    const { rows: debtors } = await db.execute(`SELECT m.id, m.name, m.phone, m.debt_months, u.email FROM members m JOIN users u ON m.user_id = u.id WHERE m.debt_months > 0 ORDER BY m.debt_months DESC`);

    res.render('admin/finances', { title: 'Finances', revenueThisMonth: Number(r1[0].total), totalRevenue: Number(r2[0].total), totalDebt: Number(r3[0].total), debtors });
  } catch (err) { console.error(err); res.redirect('/admin'); }
});

// --- RELANCE EMAIL ---
router.post('/finances/remind/:memberId', async (req, res) => {
  try {
    const { rows } = await db.execute({ sql: `SELECT m.*, u.email FROM members m JOIN users u ON m.user_id = u.id WHERE m.id = ?`, args: [req.params.memberId] });
    const member = rows[0];
    if (!member || Number(member.debt_months) <= 0) { req.flash('error', 'Membre à jour.'); return res.redirect('/admin/finances'); }
    const success = await sendReminderEmail(member.email, member.name, member.debt_months, Number(member.debt_months) * 500);
    req.flash(success ? 'success' : 'error', success ? `Relance envoyée à ${member.name}` : `Erreur d'envoi à ${member.name}`);
    res.redirect('/admin/finances');
  } catch (err) { res.redirect('/admin/finances'); }
});

// --- MEMBRES ---
router.get('/members', async (req, res) => {
  const { rows: members } = await db.execute(`SELECT u.id as user_id, u.email, u.status as user_status, u.role, m.id as member_id, m.name, m.phone, m.spec, m.debt_months FROM users u LEFT JOIN members m ON m.user_id = u.id ORDER BY u.role DESC, m.name ASC`);
  res.render('admin/members', { title: 'Membres', members });
});

router.post('/members', async (req, res) => {
  const { name, phone, email, password, debt, role } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!name || !phone || !cleanEmail || !password || password.length < 6) { req.flash('error', 'Champs requis (min 6).'); return res.redirect('/admin/members'); }
  const { rows } = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [cleanEmail] });
  if (rows.length > 0) { req.flash('error', 'Email déjà utilisé.'); return res.redirect('/admin/members'); }

  const userRole = role === 'admin' ? 'admin' : 'member';
  const hash = bcrypt.hashSync(password, 12);
  const u = await db.execute({ sql: "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)", args: [cleanEmail, hash, userRole] });
  
  if (userRole === 'member') {
    const m = await db.execute({ sql: "INSERT INTO members (user_id, name, phone, spec, debt_months) VALUES (?, ?, ?, 'À définir', ?)", args: [Number(u.lastInsertRowid), name, phone, parseInt(debt) || 0] });
    if (parseInt(debt) > 0) await seedPendingContributions(Number(m.lastInsertRowid), parseInt(debt));
  }
  req.flash('success', `Membre ${name} créé — MDP : ${password}`);
  res.redirect('/admin/members');
});

// --- SUPPRIMER UN MEMBRE ---
router.post('/members/:id/delete', async (req, res) => {
  try {
    const { rows } = await db.execute({ sql: "SELECT user_id FROM members WHERE id = ?", args: [req.params.id] });
    if (rows.length > 0) {
      await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [rows[0].user_id] });
      req.flash('success', 'Membre supprimé définitivement.');
    }
  } catch (err) { console.error(err); req.flash('error', 'Erreur de suppression.'); }
  res.redirect('/admin/members');
});

// --- EDITER MEMBRE ---
router.post('/members/:id', async (req, res) => {
  const { name, phone, spec, email } = req.body;
  const { rows: mRows } = await db.execute({ sql: "SELECT * FROM members WHERE id = ?", args: [req.params.id] });
  const member = mRows[0];
  if (!member) { req.flash('error', 'Introuvable.'); return res.redirect('/admin/members'); }
  const cleanEmail = (email || '').trim().toLowerCase();
  const { rows: uRows } = await db.execute({ sql: "SELECT email FROM users WHERE id = ?", args: [member.user_id] });
  if (cleanEmail && cleanEmail !== uRows[0].email) {
    const { rows: check } = await db.execute({ sql: "SELECT id FROM users WHERE email = ? AND id != ?", args: [cleanEmail, member.user_id] });
    if (check.length > 0) { req.flash('error', 'Email déjà utilisé.'); return res.redirect('/admin/members'); }
    await db.execute({ sql: "UPDATE users SET email = ? WHERE id = ?", args: [cleanEmail, member.user_id] });
  }
  await db.execute({ sql: "UPDATE members SET name = ?, phone = ?, spec = ? WHERE id = ?", args: [name, phone, spec, member.id] });
  req.flash('success', 'Membre mis à jour.');
  res.redirect('/admin/members');
});

router.post('/users/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) { req.flash('error', 'Min. 6 caractères.'); return res.redirect('/admin/members'); }
  await db.execute({ sql: "UPDATE users SET password_hash = ? WHERE id = ?", args: [bcrypt.hashSync(password, 12), req.params.id] });
  req.flash('success', `MDP réinitialisé.`);
  res.redirect('/admin/members');
});

router.post('/users/:id/toggle', async (req, res) => {
  const { rows } = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.params.id] });
  if (!rows[0]) return res.redirect('/admin/members');
  await db.execute({ sql: "UPDATE users SET status = ? WHERE id = ?", args: [rows[0].status === 'actif' ? 'suspendu' : 'actif', rows[0].id] });
  req.flash('success', `Statut mis à jour.`);
  res.redirect('/admin/members');
});

router.post('/members/:id/debt', async (req, res) => {
  await db.execute({ sql: "UPDATE members SET debt_months = ? WHERE id = ?", args: [parseInt(req.body.debt) || 0, req.params.id] });
  req.flash('success', 'Dette mise à jour.');
  res.redirect('/admin/members');
});

// --- PAIEMENTS ---
router.get('/payments', async (req, res) => {
  const { rows: payments } = await db.execute(`SELECT p.*, m.name as member_name FROM payment_requests p JOIN members m ON m.id = p.member_id ORDER BY p.created_at DESC`);
  res.render('admin/payments', { title: 'Paiements', payments });
});

router.post('/payments/:id/validate', async (req, res) => {
  const { rows: pRows } = await db.execute({ sql: "SELECT * FROM payment_requests WHERE id = ?", args: [req.params.id] });
  const payment = pRows[0];
  if (!payment || payment.status !== 'pending') { req.flash('error', 'Déjà traité.'); return res.redirect('/admin/payments'); }
  const { rows: mRows } = await db.execute({ sql: "SELECT * FROM members WHERE id = ?", args: [payment.member_id] });
  const member = mRows[0];
  await db.execute({ sql: "UPDATE members SET debt_months = ? WHERE id = ?", args: [Number(member.debt_months) - Number(payment.months), member.id] });
  await db.execute({ sql: "UPDATE payment_requests SET status = 'validated' WHERE id = ?", args: [payment.id] });
  
  const today = new Date().toISOString().slice(0, 10);
  let remaining = Number(payment.months);
  const { rows: pending } = await db.execute({ sql: "SELECT * FROM contributions WHERE member_id = ? AND status = 'pending' ORDER BY year DESC, id DESC LIMIT ?", args: [member.id, remaining] });
  for (const c of pending) { await db.execute({ sql: "UPDATE contributions SET status = 'paid', paid_at = ? WHERE id = ?", args: [today, c.id] }); remaining--; }
  
  if (remaining > 0) {
    const { rows: lastRows } = await db.execute({ sql: "SELECT year, month FROM contributions WHERE member_id = ? ORDER BY year DESC, id DESC LIMIT 1", args: [member.id] });
    let lastRecord = lastRows[0];
    let futureDate = new Date();
    if (lastRecord) { const monthIdx = MONTH_NAMES.indexOf(lastRecord.month); if (monthIdx !== -1) futureDate = new Date(Number(lastRecord.year), monthIdx, 1); }
    for (let i = 0; i < remaining; i++) {
      futureDate.setMonth(futureDate.getMonth() + 1);
      await db.execute({ sql: "INSERT INTO contributions (member_id, month, year, amount, status, paid_at) VALUES (?, ?, ?, ?, 'paid', ?)", args: [member.id, MONTH_NAMES[futureDate.getMonth()], futureDate.getFullYear(), MONTHLY_FEE, today] });
    }
  }
  req.flash('success', `Paiement validé.`);
  res.redirect('/admin/payments');
});

router.post('/payments/:id/reject', async (req, res) => {
  await db.execute({ sql: "UPDATE payment_requests SET status = 'rejected' WHERE id = ?", args: [req.params.id] });
  req.flash('info', 'Paiement rejeté.');
  res.redirect('/admin/payments');
});

// --- CANDIDATURES ---
router.get('/applications', async (req, res) => {
  const { rows: applications } = await db.execute("SELECT * FROM applications ORDER BY created_at DESC");
  res.render('admin/applications', { title: 'Candidatures', applications });
});

router.post('/applications/:id/accept', async (req, res) => {
  const { rows } = await db.execute({ sql: "SELECT * FROM applications WHERE id = ?", args: [req.params.id] });
  const app = rows[0];
  if (!app) { req.flash('error', 'Introuvable.'); return res.redirect('/admin/applications'); }
  const password = 'AT' + Math.random().toString(36).slice(-6).toUpperCase();
  try {
    const u = await db.execute({ sql: "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'member')", args: [app.email, bcrypt.hashSync(password, 12)] });
    await db.execute({ sql: "INSERT INTO members (user_id, name, phone, spec) VALUES (?, ?, ?, ?)", args: [Number(u.lastInsertRowid), app.name, app.phone, app.spec] });
    await db.execute({ sql: "UPDATE applications SET status = 'accepted' WHERE id = ?", args: [app.id] });
    req.flash('success', `Membre créé. MDP: ${password}`);
  } catch (e) { req.flash('error', 'Email déjà utilisé.'); }
  res.redirect('/admin/applications');
});

router.post('/applications/:id/reject', async (req, res) => {
  await db.execute({ sql: "UPDATE applications SET status = 'rejected' WHERE id = ?", args: [req.params.id] });
  req.flash('info', 'Candidature rejetée.');
  res.redirect('/admin/applications');
});

// --- NEWS ---
router.get('/news', async (req, res) => {
  const { rows: news } = await db.execute("SELECT * FROM news ORDER BY created_at DESC");
  res.render('admin/news', { title: 'News', news });
});

router.post('/news', upload.single('image'), async (req, res) => {
  const { title, category, content } = req.body;
  if (!title || !category || !content) { req.flash('error', 'Champs requis.'); return res.redirect('/admin/news'); }
  const authorName = req.session.user.email === 'admin@atgsm.bj' ? 'Administrateur' : req.session.user.email;
  await db.execute({ sql: "INSERT INTO news (title, category, content, image_path, author) VALUES (?, ?, ?, ?, ?)", args: [title, category, content, req.file ? req.file.filename : null, authorName] });
  req.flash('success', 'Annonce publiée.');
  res.redirect('/admin/news');
});

router.post('/news/:id/delete', async (req, res) => {
  await db.execute({ sql: "DELETE FROM news WHERE id = ?", args: [req.params.id] });
  req.flash('info', 'Annonce supprimée.');
  res.redirect('/admin/news');
});

// --- REÇU ADMIN ---
router.get('/receipt/:ref', async (req, res) => {
  const { rows } = await db.execute({ sql: `SELECT p.*, m.name, m.spec, m.phone FROM payment_requests p JOIN members m ON p.member_id = m.id WHERE p.ref = ?`, args: [req.params.ref] });
  if (!rows[0]) return res.status(404).send('Introuvable');
  res.render('member/receipt', { payment: rows[0], member: { name: rows[0].name, spec: rows[0].spec, phone: rows[0].phone }, MONTHLY_FEE: 500 });
});

module.exports = router;