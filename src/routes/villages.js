const express = require('express');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();

// ── POST /api/villages ─────────────────────────────────────────────────────
// Field worker submits a new village survey
router.post('/', auth, async (req, res) => {
  const {
    name, name_urdu, local_name,
    lat, lng, gps_accuracy_m,
    district, tehsil,
    households, population,
    children_5_16, boys_5_16, girls_5_16,
    notes, photo_urls,
  } = req.body;

  if (!name || !lat || !lng || !district) {
    return res.status(400).json({ error: 'name, lat, lng, district are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert village
    const villageResult = await client.query(
      `INSERT INTO villages
         (name, name_urdu, local_name,
          location, gps_accuracy_m,
          district, tehsil,
          households, population,
          children_5_16, boys_5_16, girls_5_16,
          surveyed_by, surveyed_at,
          survey_notes, photo_urls)
       VALUES
         ($1, $2, $3,
          ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6,
          $7, $8,
          $9, $10,
          $11, $12, $13,
          $14, NOW(),
          $15, $16)
       RETURNING id`,
      [
        name, name_urdu || null, local_name || null,
        lat, lng, gps_accuracy_m || null,
        district, tehsil || null,
        households || null, population || null,
        children_5_16 || null, boys_5_16 || null, girls_5_16 || null,
        req.worker.id,
        notes || null,
        photo_urls || null,
      ]
    );

    const villageId = villageResult.rows[0].id;

    // 2. Compute nearest school and access verdict
    await client.query('SELECT compute_school_access($1)', [villageId]);

    // 3. Get the updated village with access verdict
    const updated = await client.query(
      `SELECT
         v.*,
         ST_Y(v.location::geometry)  AS latitude,
         ST_X(v.location::geometry)  AS longitude,
         s.name                       AS nearest_school_name,
         s.school_type                AS nearest_school_type
       FROM villages v
       LEFT JOIN schools s ON s.id = v.nearest_school_id
       WHERE v.id = $1`,
      [villageId]
    );

    await client.query('COMMIT');

    const village = updated.rows[0];

    res.status(201).json({
      village_id:            village.id,
      name:                  village.name,
      district:              village.district,
      latitude:              village.latitude,
      longitude:             village.longitude,
      has_school_access:     village.has_school_access,
      nearest_school_dist_mi: village.nearest_school_dist_mi,
      nearest_school_name:   village.nearest_school_name,
      nearest_school_type:   village.nearest_school_type,
      children_5_16:         village.children_5_16,
      // Verdict message for the mobile app
      verdict: village.has_school_access
        ? `✓ School access — nearest school is ${parseFloat(village.nearest_school_dist_mi).toFixed(2)} miles away`
        : `✗ NO school access — nearest school is ${parseFloat(village.nearest_school_dist_mi).toFixed(2)} miles away`,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Village survey error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/villages ──────────────────────────────────────────────────────
// List villages with optional filters
router.get('/', auth, async (req, res) => {
  const { district, access, limit = 100, offset = 0 } = req.query;

  let query  = `
    SELECT
      v.id, v.name, v.district, v.tehsil,
      ST_Y(v.location::geometry)  AS latitude,
      ST_X(v.location::geometry)  AS longitude,
      v.children_5_16,
      v.has_school_access,
      v.nearest_school_dist_mi,
      v.intervention_status,
      v.surveyed_at,
      s.name AS nearest_school_name
    FROM villages v
    LEFT JOIN schools s ON s.id = v.nearest_school_id
    WHERE 1=1`;

  const params = [];

  if (district) {
    params.push(district);
    query += ` AND v.district ILIKE $${params.length}`;
  }
  if (access === 'false') query += ` AND v.has_school_access = FALSE`;
  if (access === 'true')  query += ` AND v.has_school_access = TRUE`;

  params.push(limit, offset);
  query += ` ORDER BY v.surveyed_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  try {
    const result = await pool.query(query, params);
    res.json({ count: result.rows.length, villages: result.rows });
  } catch (err) {
    console.error('Villages list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/villages/whitespace ───────────────────────────────────────────
// Villages with no school access — TAKMIL's priority target list
router.get('/whitespace', auth, async (req, res) => {
  const { district } = req.query;

  let query  = 'SELECT * FROM whitespace_villages WHERE 1=1';
  const params = [];

  if (district) {
    params.push(district);
    query += ` AND district ILIKE $${params.length}`;
  }

  query += ' LIMIT 200';

  try {
    const result = await pool.query(query, params);
    res.json({
      count:    result.rows.length,
      villages: result.rows,
    });
  } catch (err) {
    console.error('Whitespace error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/villages/:id ──────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.*,
         ST_Y(v.location::geometry) AS latitude,
         ST_X(v.location::geometry) AS longitude,
         s.name AS nearest_school_name,
         s.school_type AS nearest_school_type,
         w.name AS surveyed_by_name
       FROM villages v
       LEFT JOIN schools s ON s.id = v.nearest_school_id
       LEFT JOIN workers w ON w.id = v.surveyed_by
       WHERE v.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Village not found' });
    }

    res.json({ village: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
