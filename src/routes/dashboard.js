const express = require('express');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();

// ── GET /api/dashboard/summary ─────────────────────────────────────────────
// Top-level stats for the admin dashboard
router.get('/summary', auth, async (req, res) => {
  try {
    const [villages, schools, whitespace, workers] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM villages'),
      pool.query('SELECT COUNT(*) FROM schools WHERE status = $1', ['functional']),
      pool.query('SELECT COUNT(*) FROM villages WHERE has_school_access = FALSE'),
      pool.query('SELECT COUNT(*) FROM workers WHERE is_active = TRUE'),
    ]);

    const childrenAtRisk = await pool.query(
      'SELECT COALESCE(SUM(children_5_16), 0) AS total FROM villages WHERE has_school_access = FALSE'
    );

    res.json({
      total_villages_surveyed: parseInt(villages.rows[0].count),
      total_schools:           parseInt(schools.rows[0].count),
      whitespace_villages:     parseInt(whitespace.rows[0].count),
      active_field_workers:    parseInt(workers.rows[0].count),
      children_at_risk:        parseInt(childrenAtRisk.rows[0].total),
    });

  } catch (err) {
    console.error('Dashboard summary error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/dashboard/districts ───────────────────────────────────────────
// District-level whitespace breakdown
router.get('/districts', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM district_summary');
    res.json({ districts: result.rows });
  } catch (err) {
    console.error('Districts error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
