const express = require('express');
const router = express.Router();
const db = require('../db/database');

router.get('/members', async (req, res) => {
  try {
    const { rows: members } = await db.execute("SELECT id, name, spec, skills, url, bio, photo_path FROM members WHERE spec != 'Admin'");
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;