const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../db/database');
const { redirectIfLoggedIn } = require('../middleware/auth');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

router.get('/login', redirectIfLoggedIn, (req, res) => res.render('login', { title: 'Connexion' }));

router.post('/login', redirectIfLoggedIn, (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.flash('error', 'Email ou mot de passe incorrect.');
    return res.redirect('/auth/login');
  }
  if (user.status !== 'actif') {
    req.flash('error', 'Compte suspendu. Contactez l\'administration.');
    return res.redirect('/auth/login');
  }
  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.redirect(user.role === 'admin' ? '/admin' : '/member');
});

// --- MOT DE PASSE OUBLIÉ : DEMANDE ---
router.get('/forgot-password', (req, res) => res.render('forgot-password', { title: 'Mot de passe oublié' }));

router.post('/forgot-password', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user) {
    req.flash('success', 'Si cet email existe, un lien de réinitialisation a été envoyé.');
    return res.redirect('/auth/login');
  }

  const token = crypto.randomBytes(20).toString('hex');
  const expires = Date.now() + 3600000; // 1 heure
  db.prepare("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?").run(token, expires, user.id);

  const resetUrl = `http://localhost:3000/auth/reset-password/${token}`;
  const mailOptions = {
    from: '"AT-GSM Bohicon" <noreply@atgsm.bj>',
    to: user.email,
    subject: 'Réinitialisation de votre mot de passe',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #dc2626; text-align: center;">AT-GSM Bohicon</h2>
        <p>Bonjour,</p>
        <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous :</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Réinitialiser mon mot de passe</a>
        </div>
        <p style="color: #666; font-size: 12px;">Ce lien est valable pendant 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    req.flash('success', 'Un email de réinitialisation vous a été envoyé.');
  } catch (err) {
    console.error("Erreur d'envoi d'email:", err);
    console.log("⚠️ LIEN DE TEST (copie-colle dans ton navigateur) :", resetUrl);
    req.flash('info', 'Email non configuré. Regardez votre terminal (console) pour le lien de test.');
  }
  res.redirect('/auth/login');
});

// --- MOT DE PASSE OUBLIÉ : NOUVEAU MOT DE PASSE ---
router.get('/reset-password/:token', (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?").get(req.params.token, Date.now());
  if (!user) {
    req.flash('error', 'Le lien est invalide ou a expiré.');
    return res.redirect('/auth/forgot-password');
  }
  res.render('reset-password', { title: 'Nouveau mot de passe', token: req.params.token });
});

router.post('/reset-password/:token', (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?").get(req.params.token, Date.now());
  const newPwd = req.body.password;

  if (!user) {
    req.flash('error', 'Le lien est invalide ou a expiré.');
    return res.redirect('/auth/forgot-password');
  }
  if (!newPwd || newPwd.length < 6) {
    req.flash('error', 'Le mot de passe doit faire 6 caractères minimum.');
    return res.redirect(`/auth/reset-password/${req.params.token}`);
  }

  const hash = bcrypt.hashSync(newPwd, 12);
  db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?").run(hash, user.id);

  req.flash('success', 'Votre mot de passe a été modifié avec succès. Connectez-vous !');
  res.redirect('/auth/login');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;