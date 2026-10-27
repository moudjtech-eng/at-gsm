const { sendReceiptEmail, sendAdminNotificationEmail } = require('../utils/mailer');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../db/database');
const { requireMember } = require('../middleware/auth');
const { kkiapay } = require('@kkiapay-org/nodejs-sdk');

const upload = multer({
  dest: 'public/uploads/',
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  }
});

const MONTHLY_FEE = 500;
const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

router.use(requireMember);

// --- DASHBOARD ---
router.get('/', async (req, res) => {
  try {
    const { rows: memberRows } = await db.execute({ sql: "SELECT * FROM members WHERE user_id = ?", args: [req.session.user.id] });
    const member = memberRows[0];
    if (!member) return res.status(404).render('error', { title: 'Profil introuvable', message: 'Aucun profil membre associé.' });

    const { rows: payments } = await db.execute({ sql: "SELECT * FROM payment_requests WHERE member_id = ? ORDER BY created_at DESC", args: [member.id] });
    const { rows: contributions } = await db.execute({ sql: "SELECT * FROM contributions WHERE member_id = ? ORDER BY year DESC, id DESC", args: [member.id] });

    res.render('member/dashboard', {
      title: 'Mon Espace',
      member, 
      payments, 
      contributions,
      balance: Number(member.debt_months) * MONTHLY_FEE,
      MONTHLY_FEE
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Erreur', message: 'Erreur de chargement.' });
  }
});

// --- MODIFICATION DU PROFIL (AVEC LIEU ET GPS) ---
router.get('/profile', async (req, res) => {
  const { rows } = await db.execute({ sql: "SELECT * FROM members WHERE user_id = ?", args: [req.session.user.id] });
  res.render('member/profile', { title: 'Mon Profil', member: rows[0] });
});

router.post('/profile', upload.single('photo'), async (req, res) => {
  const { rows } = await db.execute({ sql: "SELECT * FROM members WHERE user_id = ?", args: [req.session.user.id] });
  const member = rows[0];
  
  // On récupère tous les champs, y compris location, latitude et longitude
  const { name, spec, skills, url, bio, location, latitude, longitude } = req.body;
  const photoPath = req.file ? req.file.filename : member.photo_path;

  await db.execute({
    sql: `UPDATE members SET name = ?, spec = ?, skills = ?, url = ?, bio = ?, location = ?, latitude = ?, longitude = ?, photo_path = ? WHERE user_id = ?`,
    args: [name, spec, skills, url, bio, location, latitude || null, longitude || null, photoPath, req.session.user.id]
  });

  req.flash('success', 'Profil mis à jour avec succès.');
  res.redirect('/member/profile');
});

// --- CHANGEMENT DE MOT DE PASSE ---
router.post('/password', async (req, res) => {
  const { current, newPwd, confirm } = req.body;
  const { rows } = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.session.user.id] });
  const user = rows[0];

  if (!bcrypt.compareSync(current || '', user.password_hash)) {
    req.flash('error', 'Mot de passe actuel incorrect.');
    return res.redirect('/member/profile');
  }
  if ((newPwd || '').length < 6) {
    req.flash('error', 'Le nouveau mot de passe doit faire 6 caractères minimum.');
    return res.redirect('/member/profile');
  }
  if (newPwd !== confirm) {
    req.flash('error', 'Les deux mots de passe ne correspondent pas.');
    return res.redirect('/member/profile');
  }

  await db.execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [bcrypt.hashSync(newPwd, 12), req.session.user.id]
  });
  req.flash('success', 'Mot de passe changé avec succès.');
  res.redirect('/member/profile');
});

// --- REÇU / FACTURE ---
router.get('/receipt/:ref', async (req, res) => {
  const { rows: mRows } = await db.execute({ sql: "SELECT * FROM members WHERE user_id = ?", args: [req.session.user.id] });
  const member = mRows[0];
  
  const { rows: pRows } = await db.execute({
    sql: "SELECT * FROM payment_requests WHERE ref = ? AND member_id = ?",
    args: [req.params.ref, member.id]
  });
  const payment = pRows[0];
  
  if (!payment) return res.status(404).send('Reçu introuvable');
  res.render('member/receipt', { payment, member, MONTHLY_FEE });
});

// --- PAIEMENT KKIAPAY (VÉRIFICATION SÉCURISÉE AVEC LE SDK OFFICIEL) ---
router.post('/pay-kkiapay', async (req, res) => {
  const { transactionId, months } = req.body;
  const { rows: mRows } = await db.execute({ sql: "SELECT * FROM members WHERE user_id = ?", args: [req.session.user.id] });
  const member = mRows[0];
  
  if (!transactionId || !months) {
    return res.json({ success: false, message: "Données de paiement manquantes." });
  }

  try {
    console.log(`🔍 Vérification de la transaction Kkiapay via SDK : ${transactionId}`);

    const k = kkiapay({
      privatekey: process.env.KKIA_PRIVATE_KEY,
      publickey: process.env.KKIA_PUBLIC_KEY,
      secretkey: process.env.KKIA_SECRET_KEY,
      sandbox: true // ⚠️ Passe à "false" en production (vrai argent)
    });

    let kkiaData = null;
    let isSuccess = false;

    for (let attempt = 1; attempt <= 5; attempt++) {
      kkiaData = await k.verify(transactionId);
      console.log(`📡 Tentative ${attempt} - Réponse KkiaPay :`, kkiaData);

      if (kkiaData.status && kkiaData.status.toUpperCase() === "SUCCESS") {
        isSuccess = true;
        break;
      }
      
      if (attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    if (!isSuccess) {
      return res.json({ success: false, message: "KkiaPay n'a pas confirmé le paiement (Statut: " + (kkiaData ? kkiaData.status : 'Inconnu') + ")." });
    }

    const montantAttendu = parseInt(months) * MONTHLY_FEE;
    if (Number(kkiaData.amount) < montantAttendu) {
      return res.json({ success: false, message: "Le montant payé est inférieur au montant attendu." });
    }

    const ref = transactionId;
    const monthsPaid = parseInt(months);
    
    await db.execute({
      sql: "INSERT INTO payment_requests (member_id, months, amount, ref, status) VALUES (?, ?, ?, ?, 'validated')",
      args: [member.id, monthsPaid, montantAttendu, ref]
    });

    const newDebt = Number(member.debt_months) - monthsPaid;
    await db.execute({ sql: "UPDATE members SET debt_months = ? WHERE id = ?", args: [newDebt, member.id] });

    const today = new Date().toISOString().slice(0, 10);
    let remaining = monthsPaid;
    
    const { rows: pending } = await db.execute({
      sql: "SELECT * FROM contributions WHERE member_id = ? AND status = 'pending' ORDER BY year DESC, id DESC LIMIT ?",
      args: [member.id, remaining]
    });
    
    for (const c of pending) {
      await db.execute({
        sql: "UPDATE contributions SET status = 'paid', paid_at = ? WHERE id = ?",
        args: [today, c.id]
      });
      remaining--;
    }

    if (remaining > 0) {
      const { rows: lastRecordRows } = await db.execute({
        sql: "SELECT year, month FROM contributions WHERE member_id = ? ORDER BY year DESC, id DESC LIMIT 1",
        args: [member.id]
      });
      let lastRecord = lastRecordRows[0];
      
      let futureDate = new Date();
      if (lastRecord) {
        const monthIdx = MONTH_NAMES.indexOf(lastRecord.month);
        if (monthIdx !== -1) {
          futureDate = new Date(Number(lastRecord.year), monthIdx, 1);
        }
      }

      for (let i = 0; i < remaining; i++) {
        futureDate.setMonth(futureDate.getMonth() + 1);
        await db.execute({
          sql: "INSERT INTO contributions (member_id, month, year, amount, status, paid_at) VALUES (?, ?, ?, ?, 'paid', ?)",
          args: [member.id, MONTH_NAMES[futureDate.getMonth()], futureDate.getFullYear(), MONTHLY_FEE, today]
        });
      }
    }

    sendReceiptEmail(
      { email: req.session.user.email, name: member.name, spec: member.spec, phone: member.phone }, 
      { ref: ref, months: monthsPaid, amount: montantAttendu }
    );

    const { rows: adminRows } = await db.execute("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
    if (adminRows.length > 0) {
      sendAdminNotificationEmail(adminRows[0].email, member.name, montantAttendu, monthsPaid, ref);
    }

    return res.json({ success: true });

  } catch (error) {
    console.error("❌ Erreur Kkiapay backend:", error);
    return res.json({ success: false, message: "Erreur de vérification KkiaPay : " + (error.message || "Erreur inconnue") });
  }
});

module.exports = router;