const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db/database');

const upload = multer({
  dest: 'public/uploads/',
  limits: { fileSize: 5 * 1024 * 1024 }, // Max 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont autorisés.'));
    }
  }
});

router.get('/', (req, res) => {
  const news = db.prepare("SELECT * FROM news ORDER BY created_at DESC LIMIT 6").all();
  res.render('home', { title: 'Accueil', news });
});

router.get('/directory', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let members = db.prepare("SELECT * FROM members WHERE spec != 'Admin'").all();
  if (q) {
    members = members.filter(m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.spec || '').toLowerCase().includes(q) ||
      (m.skills || '').toLowerCase().includes(q)
    );
  }
  res.render('directory', { title: 'Annuaire', members, q: req.query.q || '' });
});

router.get('/apply', (req, res) => {
  res.render('apply', { title: 'Postuler' });
});

router.post('/apply', upload.single('docs'), (req, res) => {
  const { name, email, phone, spec } = req.body;
  if (!name || !email || !phone || !spec) {
    req.flash('error', 'Tous les champs sont requis.');
    return res.redirect('/apply');
  }
  const exists = db.prepare("SELECT id FROM applications WHERE email = ? AND status = 'pending'").get(email);
  if (exists) {
    req.flash('error', 'Une candidature est déjà en cours avec cet email.');
    return res.redirect('/apply');
  }
  db.prepare("INSERT INTO applications (name, email, phone, spec, docs_path) VALUES (?, ?, ?, ?, ?)")
    .run(name, email, phone, spec, req.file ? req.file.filename : null);
  req.flash('success', 'Candidature envoyée ! Nous vous contacterons bientôt.');
  res.redirect('/');
});

// --- PAGE DE PROFIL PUBLIC D'UN TECHNICIEN ---
router.get('/directory/:id', (req, res) => {
  // On cherche le membre dans la base de données avec l'ID fourni dans l'URL
  const member = db.prepare("SELECT * FROM members WHERE id = ?").get(req.params.id);
  
  // Si le membre n'existe pas, on affiche une erreur 404
  if (!member || member.spec === 'Admin') {
    return res.status(404).render('error', { title: 'Profil introuvable', message: 'Ce technicien n\'existe pas.' });
  }
  
  // On affiche la page avec les données du membre
  res.render('public-profile', { title: member.name, member });
});

module.exports = router;