const db = require('../db/database');

async function requireMember(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  try {
    const { rows } = await db.execute({
      sql: "SELECT status FROM users WHERE id = ?",
      args: [req.session.user.id]
    });
    const user = rows[0];
    if (!user || user.status !== 'actif') {
      req.session.destroy(() => {});
      return res.redirect('/auth/login');
    }
    if (req.session.user.role === 'admin') return res.redirect('/admin');
    next();
  } catch (error) {
    console.error(error);
    res.redirect('/auth/login');
  }
}

async function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  try {
    const { rows } = await db.execute({
      sql: "SELECT status, role FROM users WHERE id = ?",
      args: [req.session.user.id]
    });
    const user = rows[0];
    if (!user || user.status !== 'actif' || user.role !== 'admin') {
      req.session.destroy(() => {});
      return res.status(403).render('error', { title: 'Accès refusé', message: 'Vous devez être administrateur.' });
    }
    next();
  } catch (error) {
    console.error(error);
    res.redirect('/auth/login');
  }
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/member');
  }
  next();
}

module.exports = { requireMember, requireAdmin, redirectIfLoggedIn };