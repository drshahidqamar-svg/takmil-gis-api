const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ───────────────────────────────────────────────────
// Field worker logs in with phone + PIN
router.post('/login', async (req, res) => {
  const { phone, pin } = req.body;

  if (!phone || !pin) {
    return res.status(400).json({ error: 'Phone and PIN are required' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM workers WHERE phone = $1 AND is_active = TRUE',
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid phone or PIN' });
    }

    const worker = result.rows[0];
    const valid  = await bcrypt.compare(pin, worker.pin_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid phone or PIN' });
    }

    // Update last login
    await pool.query(
      'UPDATE workers SET last_login = NOW() WHERE id = $1',
      [worker.id]
    );

    const token = jwt.sign(
      { id: worker.id, name: worker.name, role: worker.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      worker: {
        id:       worker.id,
        name:     worker.name,
        phone:    worker.phone,
        role:     worker.role,
        district: worker.district,
        city:     worker.city,
      },
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/register ────────────────────────────────────────────────
// Admin registers a new field worker
router.post('/register', auth, async (req, res) => {
  if (req.worker.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { name, phone, pin, district, city } = req.body;

  if (!name || !phone || !pin) {
    return res.status(400).json({ error: 'Name, phone, and PIN are required' });
  }

  try {
    const pin_hash = await bcrypt.hash(pin, 10);

    const result = await pool.query(
      `INSERT INTO workers (name, phone, pin_hash, district, city)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, phone, district, city`,
      [name, phone, pin_hash, district || null, city || null]
    );

    res.status(201).json({ worker: result.rows[0] });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Phone number already registered' });
    }
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, phone, role, district, city, last_login FROM workers WHERE id = $1',
      [req.worker.id]
    );
    res.json({ worker: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
