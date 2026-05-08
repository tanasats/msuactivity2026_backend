import pg from 'pg';

const { Pool, types } = pg;

// pg client default return DECIMAL/NUMERIC เป็น string เพื่อกัน precision loss
// แต่ในระบบนี้ค่าเงินสูงสุด ~10 พันล้าน + ชั่วโมง 1-2 หลัก — float มีพอแล้ว
// แปลงเป็น number ที่ DB layer ให้ frontend ใช้ตรง ๆ ได้โดยไม่ต้อง Number() ทุกที่
types.setTypeParser(types.builtins.NUMERIC, (val) =>
  val === null ? null : parseFloat(val),
);

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
