const { createClient } = require('@libsql/client');
const path = require('path');

// Si on a les variables Turso (sur Render), on utilise Turso.
// Sinon (sur ton PC), on utilise le fichier local.
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'atgsm.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

module.exports = db;