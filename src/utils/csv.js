// CSV utility — สร้าง CSV string จาก row objects + ส่งกลับเป็น attachment
//   - escape: " → "", ครอบด้วย " ถ้ามี , / " / newline
//   - prepend UTF-8 BOM ให้ Excel เปิดภาษาไทยถูก
//   - ค่า null/undefined → empty string

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// rows: array ของ object, columns: array ของ { key, label }
//   ใช้ \r\n เพื่อให้ Excel/Numbers อ่านได้ดีทั้งหมด
export function rowsToCsv(rows, columns) {
  const lines = [
    columns.map((c) => escapeCell(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => escapeCell(r[c.key])).join(',')),
  ];
  return lines.join('\r\n');
}

// ส่งกลับ CSV ผ่าน res — set header + BOM + body
//   filename: ใส่ .csv ให้เอง
export function sendCsv(res, filename, csv) {
  const safeName = filename.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  // UTF-8 BOM (0xEF 0xBB 0xBF) — Excel ใช้ตรวจจับ encoding
  res.write('﻿');
  res.end(csv);
}
