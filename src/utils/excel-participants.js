import ExcelJS from 'exceljs';

// ── Excel workbook สำหรับ "รายชื่อผู้เข้าร่วมกิจกรรม" ───────────────
//   - row 1-5: header info (title, code, schedule, count)
//   - row 7: column headers (bold + indigo bg + filter dropdown)
//   - row 8+: data rows
//   - freeze: row 1-7 (header) + col A (sequence)

const REG_STATUS_TH = {
  PENDING_APPROVAL: 'รออนุมัติ',
  REGISTERED: 'อนุมัติแล้ว',
  WAITLISTED: 'รอคิว',
  CANCELLED_BY_USER: 'นิสิตยกเลิก',
  CANCELLED_BY_STAFF: 'เจ้าหน้าที่ยกเลิก',
  REJECTED_BY_STAFF: 'ปฏิเสธ',
  ATTENDED: 'เช็คอินแล้ว',
  NO_SHOW: 'ไม่ได้เข้าร่วม',
};

const ROLE_TH = {
  PARTICIPANT: 'ผู้เข้าร่วมกิจกรรม',
  ORGANIZER: 'ผู้ดำเนินโครงการ',
  LEADER: 'ผู้รับผิดชอบโครงการ',
};

const EVAL_TH = {
  PENDING_EVALUATION: 'รอประเมิน',
  PASSED: 'ผ่าน',
  FAILED: 'ไม่ผ่าน',
};

// แปลงวันที่ → string "dd/MM/yyyy HH:mm" (พ.ศ.)
function formatBE(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear() + 543} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function formatBEDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear() + 543}`;
}

// สร้าง workbook สำหรับส่งออก → คืน Buffer
//   activity: { id, code, title, start_at, end_at, capacity, registered_count, hours }
//   registrations: rows จาก listByActivity (ครบ field ที่ใช้)
export async function buildParticipantsWorkbook({ activity, registrations }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MSU Activity 2026';
  wb.created = new Date();

  const ws = wb.addWorksheet('ผู้เข้าร่วมกิจกรรม', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 7 }],
  });

  // ── Header info (row 1-5) ─────────────────────────────────────
  const titleCell = ws.getCell('A1');
  titleCell.value = 'รายชื่อผู้เข้าร่วมกิจกรรม';
  titleCell.font = { size: 14, bold: true };
  ws.mergeCells('A1:L1');

  ws.getCell('A2').value = `รหัสกิจกรรม: ${activity.code ?? '—'}`;
  ws.getCell('A3').value = `ชื่อกิจกรรม: ${activity.title}`;
  ws.getCell('A4').value = `วันที่จัด: ${formatBEDate(activity.start_at)} – ${formatBEDate(activity.end_at)}`;
  ws.getCell('A5').value =
    `ผู้สมัคร: ${activity.registered_count}/${activity.capacity} คน · ออกรายงานเมื่อ ${formatBE(new Date())}`;

  for (const row of [2, 3, 4, 5]) {
    ws.getCell(`A${row}`).font = { size: 11 };
    ws.mergeCells(`A${row}:L${row}`);
  }

  // row 6 เว้นว่าง

  // ── Column headers (row 7) ────────────────────────────────────
  const COLS = [
    { header: 'ลำดับ', key: 'no', width: 6 },
    { header: 'รหัสนิสิต', key: 'msu_id', width: 14 },
    { header: 'ชื่อ-นามสกุล', key: 'student_name', width: 28 },
    { header: 'คณะ', key: 'faculty_name', width: 28 },
    { header: 'อีเมล', key: 'email', width: 28 },
    { header: 'สถานะลงทะเบียน', key: 'reg_status', width: 16 },
    { header: 'สถานภาพในกิจกรรม', key: 'role', width: 22 },
    { header: 'ผลประเมิน', key: 'eval_status', width: 12 },
    { header: 'หมายเหตุประเมิน', key: 'eval_note', width: 28 },
    { header: 'วันที่สมัคร', key: 'registered_at', width: 18 },
    { header: 'วันที่เช็คอิน', key: 'attended_at', width: 18 },
    { header: 'ชั่วโมงที่ได้รับ', key: 'hours_earned', width: 14 },
  ];

  // set column widths (without using ws.columns which auto-puts headers on row 1)
  COLS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  // header row at row 7
  const headerRow = ws.getRow(7);
  COLS.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header;
  });
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' }, // indigo-600
  };
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
  });

  // ── Data rows (row 8+) ────────────────────────────────────────
  registrations.forEach((r, i) => {
    const earned = r.evaluation_status === 'PASSED' ? Number(activity.hours ?? 0) : 0;
    const rowIdx = 8 + i;
    const row = ws.getRow(rowIdx);
    row.values = [
      i + 1,
      r.msu_id ?? '',
      r.student_name,
      r.faculty_name ?? '—',
      r.email,
      REG_STATUS_TH[r.registration_status] ?? r.registration_status,
      ROLE_TH[r.participant_role] ?? r.participant_role,
      r.evaluation_status ? EVAL_TH[r.evaluation_status] : '—',
      r.evaluation_note ?? '',
      formatBE(r.registered_at),
      formatBE(r.attended_at),
      earned,
    ];
    row.alignment = { vertical: 'middle' };
    // คอลัมน์เลข align right
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(12).alignment = { vertical: 'middle', horizontal: 'right' };
    // คอลัมน์รหัสนิสิต mono
    row.getCell(2).font = { name: 'Consolas' };
  });

  // ── Auto-filter ครอบคลุม header + data ────────────────────────
  if (registrations.length > 0) {
    ws.autoFilter = {
      from: { row: 7, column: 1 },
      to: { row: 7 + registrations.length, column: COLS.length },
    };
  }

  return await wb.xlsx.writeBuffer();
}

// helper: encode filename ตาม RFC 5987 (รองรับชื่อไทย)
//   อาจไม่ค่อยใช้ — code activity เป็น ASCII อยู่แล้ว แต่ defensive
export function contentDispositionAttachment(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
