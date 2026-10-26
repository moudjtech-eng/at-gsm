const { kkiapay } = require('@kkiapay-org/nodejs-sdk');
const { sendReceiptEmail, sendAdminNotificationEmail } = require('../utils/mailer');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../db/database');
const { requireMember } = require('../middleware/auth');

// Configuration de Multer pour l'upload de photos de profil
const upload = multer({
  dest: 'public/uploads/',
  limits: { fileSize: 2 * 1024 * 1024 }, // Max 2MB
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  }
});

const MONTHLY_FEE = 500;
const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// Middleware : Toutes les routes ici nécessitent d'être connecté en tant que membre
router.use(requireMember);

// --- DASHBOARD ---
router.get('/', (req, res) => {
  const member = db.prepare("SELECT * FROM members WHERE user_id = ?").get(req.session.user.id);
  if (!member) return res.status(404).render('error', { title: 'Profil introuvable', message: 'Aucun profil membre associé.' });

  const payments = db.prepare("SELECT * FROM payment_requests WHERE member_id = ? ORDER BY created_at DESC").all(member.id);
  const contributions = db.prepare("SELECT * FROM contributions WHERE member_id = ? ORDER BY year DESC, id DESC").all(member.id);

  res.render('member/dashboard', {
    title: 'Mon Espace',
    member, 
    payments, 
    contributions,
    balance: member.debt_months * MONTHLY_FEE,
    MONTHLY_FEE
  });
});

// --- MODIFICATION DU PROFIL ---
router.get('/profile', (req, res) => {
  const member = db.prepare("SELECT * FROM members WHERE user_id = ?").get(req.session.user.id);
  res.render('member/profile', { title: 'Mon Profil', member });
});

router.post('/profile', upload.single('photo'), (req, res) => {
  const member = db.prepare("SELECT * FROM members WHERE user_id = ?").get(req.session.user.id);
  const { name, spec, skills, url, bio } = req.body;
  const photoPath = req.file ? req.file.filename : member.photo_path;

  db.prepare(`UPDATE members SET name = ?, spec = ?, skills = ?, url = ?, bio = ?, photo_path = ? WHERE user_id = ?`)
    .run(name, spec, skills, url, bio, photoPath, req.session.user.id);

  req.flash('success', 'Profil mis à jour avec succès.');
  res.redirect('/member/profile');
});

// --- CHANGEMENT DE MOT DE PASSE ---
router.post('/password', (req, res) => {
  const { current, newPwd, confirm } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.user.id);

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

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(newPwd, 12), req.session.user.id);
  req.flash('success', 'Mot de passe changé avec succès.');
  res.redirect('/member/profile');
});

// --- REÇU / FACTURE ---
router.get('/receipt/:ref', (req, res) => {
  const member = db.prepare("SELECT * FROM members WHERE user_id = ?").get(req.session.user.id);
  const payment = db.prepare("SELECT * FROM payment_requests WHERE ref = ? AND member_id = ?").get(req.params.ref, member.id);
  
  if (!payment) return res.status(404).send('Reçu introuvable');
  res.render('member/receipt', { payment, member, MONTHLY_FEE });
});

// --- PAIEMENT KKIAPAY (AVEC SDK OFFICIEL) ---
router.post('/pay-kkiapay', async (req, res) => {
  const { transactionId, months } = req.body;
  const member = db.prepare("SELECT * FROM members WHERE user_id = ?").get(req.session.user.id);
  
  if (!transactionId || !months) {
    return res.json({ success: false, message: "Données de paiement manquantes." });
  }

  try {
    console.log(`🔍 Vérification de la transaction Kkiapay : ${transactionId}`);

    // Initialisation du SDK avec tes clés
    const k = kkiapay({
      privatekey: process.env.KKIA_PRIVATE_KEY,
      publickey: process.env.KKIA_PUBLIC_KEY,
      secretkey: process.env.KKIA_SECRET_KEY,
      sandbox: true // ⚠️ Mets "false" en production (vrai argent)
    });

    let kkiaData = null;
    let isSuccess = false;

    // Le SDK gère les tentatives et les délais pour nous
    for (let attempt = 1; attempt <= 5; attempt++) {
      kkiaData = await k.verify(transactionId);
      console.log(`📡 Tentative ${attempt} - Réponse de KkiaPay :`, kkiaData);

      if (kkiaData.status && kkiaData.status.toUpperCase() === "SUCCESS") {
        isSuccess = true;
        break;
      }
      
      if (attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    if (!isSuccess) {
      return res.json({ success: false, message: "KkiaPay n'a pas encore confirmé le paiement (Statut: " + (kkiaData ? kkiaData.status : 'Inconnu') + ")." });
    }

    // Vérification du montant
    const montantAttendu = parseInt(months) * MONTHLY_FEE;
    if (kkiaData.amount < montantAttendu) {
      return res.json({ success: false, message: "Le montant payé est inférieur au montant attendu." });
    }

    // --- MISE À JOUR DE LA BASE DE DONNÉES ---
    const ref = transactionId;
    const monthsPaid = parseInt(months);
    
    db.prepare("INSERT INTO payment_requests (member_id, months, amount, ref, status) VALUES (?, ?, ?, ?, 'validated')")
      .run(member.id, monthsPaid, montantAttendu, ref);

    const newDebt = member.debt_months - monthsPaid;
    db.prepare("UPDATE members SET debt_months = ? WHERE id = ?").run(newDebt, member.id);

    const today = new Date().toISOString().slice(0, 10);
    let remaining = monthsPaid;
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
        if (monthIdx !== -1) {
          futureDate = new Date(lastRecord.year, monthIdx, 1);
        }
      }

      for (let i = 0; i < remaining; i++) {
        futureDate.setMonth(futureDate.getMonth() + 1);
        db.prepare("INSERT INTO contributions (member_id, month, year, amount, status, paid_at) VALUES (?, ?, ?, ?, 'paid', ?)")
          .run(member.id, MONTH_NAMES[futureDate.getMonth()], futureDate.getFullYear(), MONTHLY_FEE, today);
      }
    }

    // --- ENVOI DES EMAILS ---
    sendReceiptEmail(
      { email: req.session.user.email, name: member.name, spec: member.spec, phone: member.phone }, 
      { ref: ref, months: monthsPaid, amount: montantAttendu }
    );

    const adminUser = db.prepare("SELECT email FROM users WHERE role = 'admin' LIMIT 1").get();
    if (adminUser) {
      sendAdminNotificationEmail(adminUser.email, member.name, montantAttendu, monthsPaid, ref);
    }

    console.log("✅ Paiement enregistré et emails envoyés.");
    return res.json({ success: true });

  } catch (error) {
    console.error("❌ Erreur Kkiapay backend:", error);
    return res.json({ success: false, message: "Erreur serveur lors de la communication avec KkiaPay." });
  }
});

module.exports = router;