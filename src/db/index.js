import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'msuactivity',
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});

export const query = (text, params) => pool.query(text, params);
