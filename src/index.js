require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const pool      = require('./db');

// Routes
const authRoutes      = require('./routes/auth');
const schoolsRoutes   = require('./routes/schools');
const villagesRoutes  = require('./routes/villages');
const dashboardRoutes = require('./routes/dashboard');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/schools',   schoolsRoutes);
app.use('/api/villages',  villagesRoutes);
app.use('/api/dashboard', dashboardRoutes);

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status:    'ok',
      app:       'TAKMIL GIS API',
      database:  'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// ── API reference ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name:    'TAKMIL GIS API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/login':    'Login with phone + PIN',
        'POST /api/auth/register': 'Register new field worker (admin only)',
        'GET  /api/auth/me':       'Get current worker profile',
      },
      schools: {
        'GET  /api/schools/nearby': 'Find schools near GPS point (?lat=&lng=&miles=)',
        'GET  /api/schools':        'List schools (?district=&type=&status=)',
        'POST /api/schools':        'Add a school manually',
      },
      villages: {
        'POST /api/villages':            'Submit village GPS survey',
        'GET  /api/villages':            'List surveyed villages (?district=&access=)',
        'GET  /api/villages/whitespace': 'Villages with NO school access',
        'GET  /api/villages/:id':        'Get single village detail',
      },
      dashboard: {
        'GET /api/dashboard/summary':   'Top-level stats',
        'GET /api/dashboard/districts': 'District-level whitespace breakdown',
      },
    },
  });
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('  TAKMIL GIS API');
  console.log(`  Running on port ${PORT}`);
  console.log(`  http://localhost:${PORT}`);
  console.log('='.repeat(50));
});
