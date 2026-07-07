// ── รูปแบบวันเวลาไทย (Asia/Bangkok, GMT+7, ปีพุทธศักราช) — ใช้ร่วมทุก export ─
//   ★ อิง timeZone 'Asia/Bangkok' เสมอ → ถูกต้องไม่ว่า server จะตั้ง timezone อะไร
//     (getDate()/getHours() ธรรมดาจะให้เวลาของ server เช่น UTC ใน production)
//   ใช้ en-GB (ได้เลข ค.ศ.) แล้ว +543 เป็น พ.ศ. เอง

const PARTS_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

// แตกค่าเป็นส่วน ๆ ตามเวลาไทย → { day, month, year(พ.ศ.), hour, minute, second } หรือ null
function bkkParts(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = {};
  for (const { type, value: v } of PARTS_FMT.formatToParts(d)) p[type] = v;
  // en-GB hour '24' ตอนเที่ยงคืนบางรุ่น → normalize เป็น '00'
  if (p.hour === '24') p.hour = '00';
  return {
    day: p.day,
    month: p.month,
    year: String(Number(p.year) + 543),
    hour: p.hour,
    minute: p.minute,
    second: p.second,
  };
}

// "dd/MM/yyyy(พ.ศ.) HH:mm:ss" — เต็ม (ใช้ใน CSV)
export function thaiDateTime(value) {
  const p = bkkParts(value);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}` : '';
}

// "dd/MM/yyyy(พ.ศ.) HH:mm" — ไม่มีวินาที (ใช้ใน Excel)
export function thaiDateTimeShort(value) {
  const p = bkkParts(value);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : '';
}

// "dd/MM/yyyy(พ.ศ.)" — วันที่อย่างเดียว
export function thaiDate(value) {
  const p = bkkParts(value);
  return p ? `${p.day}/${p.month}/${p.year}` : '';
}
