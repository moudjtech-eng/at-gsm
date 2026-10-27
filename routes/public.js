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
  const { name, email, phone, spec } = req.body;
  if (!name || !email || !phone || !spec) {
    req.flash('error', 'Tous les champs sont requis.');
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
    await db.execute({
      sql: "INSERT INTO applications (name, email, phone, spec, docs_path) VALUES (?, ?, ?, ?, ?)",
      args: [name, email, phone, spec, req.file ? req.file.filename : null]
    });
    req.flash('success', 'Candidature envoyée ! Nous vous contacterons bientôt.');
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Erreur serveur lors de l\'envoi.');
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

module.exports = router;