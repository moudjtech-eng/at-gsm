const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db/database');

const upload = multer({
  dest: 'public/uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype));
  }
});

router.get('/', async (req, res) => {
  try {
    const { rows: news } = await db.execute("SELECT * FROM news ORDER BY created_at DESC LIMIT 6");
    res.render('home', { title: 'Accueil', news });
  } catch (err) {
    console.error(err);
    res.render('home', { title: 'Accueil', news: [] });
  }
});

router.get('/directory', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    let { rows: members } = await db.execute("SELECT * FROM members WHERE spec != 'Admin'");
    
    if (q) {
      members = members.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.spec || '').toLowerCase().includes(q) ||
        (m.skills || '').toLowerCase().includes(q)
      );
    }
    res.render('directory', { title: 'Annuaire', members, q: req.query.q || '' });
  } catch (err) {
    console.error(err);
    res.render('directory', { title: 'Annuaire', members: [], q: '' });
  }
});

// PAGE DE PROFIL PUBLIC D'UN TECHNICIEN
router.get('/directory/:id', async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT * FROM members WHERE id = ?",
      args: [req.params.id]
    });
    const member = rows[0];
    
    if (!member || member.spec === 'Admin') {
      return res.status(404).render('error', { title: 'Profil introuvable', message: 'Ce technicien n\'existe pas.' });
    }
    res.render('public-profile', { title: member.name, member });
  } catch (err) {
    console.error(err);
    res.redirect('/directory');
  }
});

router.get('/apply', (req, res) => {
  res.render('apply', { title: 'Postuler' });
});

router.post('/apply', upload.single('docs'), async (req, res) => {
  const { name, email, phone, spec, member_type, trainer_phone, trainer_is_bohicon, transactionId } = req.body;
  
  if (!name || !email || !phone || !spec) {
    req.flash('error', 'Tous les champs obligatoires sont requis.');
    return res.redirect('/apply');
  }

  try {
    const { rows } = await db.execute({
      sql: "SELECT id FROM applications WHERE email = ? AND status = 'pending'",
      args: [email]
    });
    if (rows.length > 0) {
      req.flash('error', 'Une candidature est déjà en cours avec cet email.');
      return res.redirect('/apply');
    }

    let adhesionFee = 0;
    let isBohicon = 0;
    let paymentRef = null;

    // Si c'est un nouveau membre, on vérifie qu'il a bien payé
    if (member_type === 'new') {
      if (!transactionId) {
        req.flash('error', 'Le paiement des frais d\'adhésion est requis pour les nouveaux membres.');
        return res.redirect('/apply');
      }

      isBohicon = trainer_is_bohicon === '1' ? 1 : 0;
      adhesionFee = isBohicon ? 5000 : 10000;

      // --- VERIFICATION SECURISEE KKIAPAY ---
      const { kkiapay } = require('@kkiapay-org/nodejs-sdk');
      const k = kkiapay({
        privatekey: process.env.KKIA_PRIVATE_KEY,
        publickey: process.env.KKIA_PUBLIC_KEY,
        secretkey: process.env.KKIA_SECRET_KEY,
        sandbox: true
      });

      const kkiaData = await k.verify(transactionId);
      
      if (!kkiaData.status || kkiaData.status.toUpperCase() !== "SUCCESS") {
        req.flash('error', 'KkiaPay n\'a pas confirmé le paiement des frais d\'adhésion.');
        return res.redirect('/apply');
      }
      if (Number(kkiaData.amount) < adhesionFee) {
        req.flash('error', 'Le montant payé est incorrect.');
        return res.redirect('/apply');
      }
      
      paymentRef = transactionId; // On sauvegarde la preuve de paiement
    }

    // Enregistrement dans la base de données
    await db.execute({
      sql: `INSERT INTO applications 
            (name, email, phone, spec, docs_path, member_type, trainer_phone, trainer_is_bohicon, adhesion_fee, transaction_ref) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [name, email, phone, spec, req.file ? req.file.filename : null, member_type, trainer_phone || null, isBohicon, adhesionFee, paymentRef]
    });

    req.flash('success', 'Candidature envoyée avec succès ! Nous vous contacterons bientôt.');
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Erreur serveur lors de l\'envoi de la candidature.');
    res.redirect('/apply');
  }
});

// --- PAGE DÉTAIL D'UNE ACTUALITÉ ---
router.get('/news/:id', async (req, res) => {
  try {
    const { rows } = await db.execute({ 
      sql: "SELECT * FROM news WHERE id = ?", 
      args: [req.params.id] 
    });
    const article = rows[0];
    
    if (!article) {
      return res.status(404).render('error', { title: 'Article introuvable', message: 'Cet article n\'existe pas.' });
    }
    res.render('news-detail', { title: article.title, article });
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// --- PAGE À PROPOS ---
router.get('/about', (req, res) => {
  res.render('about', { title: 'À propos de nous' });
});

module.exports = router;