require('dotenv').config();
require('./db/init');

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ C'EST CETTE LIGNE QUI RÈGLE LE PROBLÈME DE DÉCONNEXION SUR RENDER
app.set('trust proxy', 1);

// Uploads dir
fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' // Ajout de sécurité supplémentaire
  }
}));

app.use(flash());

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = {
    success: req.flash('success'),
    error: req.flash('error'),
    info: req.flash('info')
  };
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- ROUTES ---
app.use('/', require('./routes/public'));
app.use('/auth', require('./routes/auth'));
app.use('/member', require('./routes/member'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// --- FACTURATION AUTOMATIQUE (CRON) ---
cron.schedule('0 0 1 * *', async () => {
    console.log('⏰ Début de la facturation mensuelle automatique...');
    
    const now = new Date();
    const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const currentMonth = MONTH_NAMES[now.getMonth()];
    const currentYear = now.getFullYear();
    const MONTHLY_FEE = 500;

    try {
        const { rows: members } = await db.execute("SELECT m.id, m.debt_months FROM members m JOIN users u ON u.id = m.user_id WHERE u.status = 'actif' AND u.role = 'member'");

        for (const m of members) {
            const { rows: billed } = await db.execute({
                sql: "SELECT id FROM contributions WHERE member_id = ? AND month = ? AND year = ?",
                args: [m.id, currentMonth, currentYear]
            });
            
            if (billed.length === 0) {
                await db.execute({
                    sql: "UPDATE members SET debt_months = debt_months + 1 WHERE id = ?",
                    args: [m.id]
                });
                await db.execute({
                    sql: "INSERT INTO contributions (member_id, month, year, amount, status) VALUES (?, ?, ?, ?, 'pending')",
                    args: [m.id, currentMonth, currentYear, MONTHLY_FEE]
                });
            }
        }
        console.log(`✅ Facturation terminée pour ${currentMonth} ${currentYear}.`);
    } catch (error) {
        console.error('❌ Erreur lors de la facturation automatique:', error);
    }
});

// --- GESTION DES ERREURS ---
app.use((req, res) => {
  res.status(404).render('error', { title: 'Page non trouvée', message: 'Cette page n\'existe pas.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Erreur serveur', message: err.message });
});

app.listen(PORT, () => {
  console.log('\n🚀 AT-GSM démarré : http://localhost:' + PORT);
});