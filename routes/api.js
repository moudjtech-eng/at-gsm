const express = require('express');
const router = express.Router();
const db = require('../db/database');

router.get('/members', (req, res) => {
  const members = db.prepare("SELECT id, name, spec, skills, url, bio, photo_path FROM members WHERE spec != 'Admin'").all();
  res.json(members);
});

module.exports = router;