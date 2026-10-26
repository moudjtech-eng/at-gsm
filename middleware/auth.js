const db = require('../db/database');

function requireMember(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare("SELECT status FROM users WHERE id = ?").get(req.session.user.id);
  if (!user || user.status !== 'actif') {
    req.session.destroy(() => {});
    return res.redirect('/auth/login');
  }
  if (req.session.user.role === 'admin') return res.redirect('/admin');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare("SELECT status, role FROM users WHERE id = ?").get(req.session.user.id);
  if (!user || user.status !== 'actif' || user.role !== 'admin') {
    req.session.destroy(() => {});
    return res.status(403).render('error', { title: 'Accès refusé', message: 'Vous devez être administrateur.' });
  }
  next();
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/member');
  }
  next();
}

module.exports = { requireMember, requireAdmin, redirectIfLoggedIn };