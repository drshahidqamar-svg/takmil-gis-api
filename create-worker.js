const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.dzngihxzmbnwvypzavzl:Takmil2025202@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function createWorker() {
  const hash = await bcrypt.hash('123456', 10);
  await pool.query('DELETE FROM workers WHERE phone = $1', ['+1-000-000-0000']);
  await pool.query(
    'INSERT INTO workers (name, phone, pin_hash, role, city) VALUES ($1, $2, $3, $4, $5)',
    ['TAKMIL Admin', '+1-000-000-0000', hash, 'admin', 'Louisville']
  );
  console.log('Worker created! PIN: 123456');
  process.exit(0);
}

createWorker().catch(e => { console.log('Error:', e.message); process.exit(1); });