const express = require('express');
const pool    = require('../db');
const auth    = require('../middleware/auth');

const router = express.Router();

// ── GET /api/schools/nearby ────────────────────────────────────────────────
// Find schools near a GPS point
// Query params: lat, lng, miles (default 10)
router.get('/nearby', auth, async (req, res) => {
  const lat   = parseFloat(req.query.lat);
  const lng   = parseFloat(req.query.lng);
  const miles = parseFloat(req.query.miles) || 10.0;

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM find_schools_within_miles($1, $2, $3)`,
      [lat, lng, miles]
    );

    const threshold = parseFloat(process.env.ACCESS_THRESHOLD_MILES) || 3.0;
    const nearest   = result.rows[0] || null;

    res.json({
      village_coords: { lat, lng },
      search_radius_miles: miles,
      schools_found: result.rows.length,
      has_school_access: nearest ? nearest.dist_mi <= threshold : false,
      nearest_school: nearest,
      all_schools: result.rows,
    });

  } catch (err) {
    console.error('Schools nearby error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/schools ───────────────────────────────────────────────────────
// List schools with optional district filter
router.get('/', auth, async (req, res) => {
  const { district, type, status, limit = 50, offset = 0 } = req.query;

  let query  = 'SELECT id, name, district, tehsil, school_type, level, gender, status, source, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM schools WHERE 1=1';
  const params = [];

  if (district) { params.push(district); query += ` AND district ILIKE $${params.length}`; }
  if (type)     { params.push(type);     query += ` AND school_type = $${params.length}`; }
  if (status)   { params.push(status);   query += ` AND status = $${params.length}`; }

  params.push(limit, offset);
  query += ` ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`;

  try {
    const result = await pool.query(query, params);
    res.json({ count: result.rows.length, schools: result.rows });
  } catch (err) {
    console.error('Schools list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/schools ──────────────────────────────────────────────────────
// Add a school manually (field worker found unlisted school)
router.post('/', auth, async (req, res) => {
  const { name, lat, lng, district, tehsil, school_type, level, gender, notes } = req.body;

  if (!name || !lat || !lng || !district) {
    return res.status(400).json({ error: 'name, lat, lng, district are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO schools
         (name, location, district, tehsil, school_type, level, gender, source, notes)
       VALUES
         ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4, $5, $6, $7, $8, 'field_survey', $9)
       RETURNING id, name, district`,
      [name, lat, lng, district, tehsil || null,
       school_type || 'public', level || null,
       gender || 'mixed', notes || null]
    );

    res.status(201).json({ school: result.rows[0] });
  } catch (err) {
    console.error('Add school error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
// ── POST /api/schools/lookup ───────────────────────────────────────────────
// Single or bulk GPS lookup — no auth required
router.post('/lookup', async (req, res) => {
  const { coordinates } = req.body;
  if (!coordinates || !Array.isArray(coordinates)) {
    return res.status(400).json({ error: 'coordinates array is required' });
  }

  try {
    const results = await Promise.all(
      coordinates.map(async (coord) => {
        const { lat, lng, name } = coord;
        if (!lat || !lng) return { ...coord, error: 'Invalid coordinates' };

        const result = await pool.query(
          `SELECT 
            s.id, s.name, s.school_type, s.level, s.gender, s.district,
            ST_Y(s.location::geometry) AS latitude,
            ST_X(s.location::geometry) AS longitude,
            ST_Distance(
              ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
              s.location
            ) AS dist_m,
            ST_Distance(
              ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
              s.location
            ) / 1609.344 AS dist_mi
          FROM schools s
          WHERE s.status = 'functional'
          ORDER BY s.location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          LIMIT 1`,
          [lat, lng]
        );

        const school = result.rows[0];
        const threshold = parseFloat(process.env.ACCESS_THRESHOLD_MILES) || 3.0;

        return {
          input_name: name || null,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          nearest_school_name: school?.name || 'No school found',
          nearest_school_type: school?.school_type || null,
          nearest_school_district: school?.district || null,
          nearest_school_lat: school ? parseFloat(school.latitude) : null,
          nearest_school_lng: school ? parseFloat(school.longitude) : null,
          dist_m: school ? parseFloat(school.dist_m).toFixed(1) : null,
          dist_mi: school ? parseFloat(school.dist_mi).toFixed(4) : null,
          has_school_access: school ? parseFloat(school.dist_mi) <= threshold : false,
          verdict: school
            ? (parseFloat(school.dist_mi) <= threshold
                ? 'Has school access'
                : 'NO school access — whitespace')
            : 'No school found',
        };
      })
    );

    res.json({ count: results.length, threshold_miles: 3.0, results });
  } catch (err) {
    console.error('Lookup error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
module.exports = router;
