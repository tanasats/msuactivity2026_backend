// render ข้อมูลทรานสคริปต์ (จาก transcript.model.getTranscriptData) → ไฟล์ Word (.docx)
//   เป็น "เอกสารตั้งต้น" ให้ admin เปิดใน Word แล้วจัดรูปแบบ/เติมข้อมูลต่อได้
//   layout อิงตามใบระเบียนกิจกรรมนิสิต: หัวเอกสาร → ข้อมูลนิสิต → ตารางกิจกรรมรายปี
//   → ผู้นำองค์กรนิสิต (ว่าง) + สรุปรวม → legend + ช่องลงนาม
//
// override: ค่าที่ admin กรอกในฟอร์ม (ไม่ทับลง DB) ส่งมาทับ header ตอน render

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const FONT = 'TH Sarabun New'; // ฟอนต์ราชการไทย — Word fallback ถ้าเครื่องไม่มี
const BLANK = '.........................';

const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

// แปลง date (Date | 'YYYY-MM-DD') → "07 มิถุนายน 2563" (ปี พ.ศ.)
function formatThaiDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${day} ${TH_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

function fmtNum(n) {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ── primitives ───────────────────────────────────────────────────────────
function run(text, opts = {}) {
  return new TextRun({ text: text ?? '', font: FONT, ...opts });
}

function para(children, opts = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    ...opts,
  });
}

function textCell(text, { bold = false, align = AlignmentType.LEFT, size = 28 } = {}) {
  return new TableCell({
    children: [
      new Paragraph({
        alignment: align,
        children: [run(String(text ?? ''), { bold, size })],
      }),
    ],
    margins: { top: 30, bottom: 30, left: 80, right: 80 },
  });
}

// แถวคู่ label:value 2 คอลัมน์ (ซ้าย/ขวา) สำหรับบล็อกข้อมูลนิสิต — ไร้เส้น
function infoRow(leftLabel, leftValue, rightLabel, rightValue) {
  const cell = (label, value, w) =>
    new TableCell({
      width: { size: w, type: WidthType.PERCENTAGE },
      borders: noBorders(),
      children: [
        new Paragraph({
          children: [
            run(`${label}  `, { bold: true, size: 28 }),
            run(value || '', { size: 28 }),
          ],
        }),
      ],
    });
  return new TableRow({
    children: [
      cell(leftLabel, leftValue, 50),
      cell(rightLabel, rightValue, 50),
    ],
  });
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: none, bottom: none, left: none, right: none };
}

function fullWidth() {
  return { size: 100, type: WidthType.PERCENTAGE };
}

// ── sections ─────────────────────────────────────────────────────────────
function buildHeader() {
  return [
    para(run('มหาวิทยาลัยมหาสารคาม', { bold: true, size: 36 }), {
      alignment: AlignmentType.CENTER,
    }),
    para(run('มหาสารคาม ประเทศไทย', { size: 28 }), {
      alignment: AlignmentType.CENTER,
    }),
    para(run('ใบระเบียนกิจกรรมนิสิต', { bold: true, size: 32 }), {
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 160 },
    }),
  ];
}

function buildStudentInfo(h) {
  const table = new Table({
    width: fullWidth(),
    borders: noBorders(),
    rows: [
      infoRow('รหัสประจำตัว', h.msu_id, 'คณะ', h.faculty_name),
      infoRow('ชื่อ-นามสกุล', h.full_name, 'สาขาวิชา/เอก', h.major_name),
      infoRow('Name', h.name_en_full, 'วันที่รับเข้าศึกษา', formatThaiDate(h.admission_date)),
      infoRow('ปริญญาที่ได้รับ', h.degree_name, '', ''),
    ],
  });
  return [table];
}

const ACT_COL_WIDTHS = [16, 44, 12, 12, 16]; // รหัส / ชื่อ / ชม. / สถานภาพ / ทักษะ

function activityHeaderRow() {
  const head = (t, align = AlignmentType.LEFT) =>
    textCell(t, { bold: true, align, size: 28 });
  return new TableRow({
    tableHeader: true,
    children: [
      head('รหัสกิจกรรม'),
      head('กิจกรรม/โครงการ'),
      head('จำนวน ชม.', AlignmentType.CENTER),
      head('สถานภาพ', AlignmentType.CENTER),
      head('ทักษะที่ได้', AlignmentType.CENTER),
    ],
  });
}

function buildYearTable(year) {
  const rows = [activityHeaderRow()];
  for (const a of year.activities) {
    rows.push(
      new TableRow({
        children: [
          textCell(a.code ?? '', { size: 28 }),
          textCell(a.title, { size: 28 }),
          textCell(fmtNum(a.hours), { align: AlignmentType.CENTER, size: 28 }),
          textCell(a.status_letter, { align: AlignmentType.CENTER, size: 28 }),
          textCell((a.skills || []).join(','), { align: AlignmentType.CENTER, size: 28 }),
        ],
      }),
    );
  }
  const table = new Table({
    width: fullWidth(),
    columnWidths: ACT_COL_WIDTHS.map((w) => w * 90),
    rows,
  });
  return [
    para(run(`ปีการศึกษา ${year.academic_year}`, { bold: true, size: 28 }), {
      spacing: { before: 160, after: 60 },
    }),
    table,
  ];
}

// ผู้นำองค์กรนิสิต — ตารางว่าง (หัวคอลัมน์ + แถวเปล่าให้กรอกมือ) + สรุปรวม
function buildOrgLeaderAndSummary(data) {
  const cols = data.org_leader_columns;
  const headRow = new TableRow({
    tableHeader: true,
    children: cols.map((c) => textCell(c, { bold: true, size: 28, align: AlignmentType.CENTER })),
  });
  const emptyRows = Array.from({ length: 4 }, () =>
    new TableRow({ children: cols.map(() => textCell(' ', { size: 28 })) }),
  );
  const orgTable = new Table({
    width: fullWidth(),
    rows: [headRow, ...emptyRows],
  });

  const s = data.summary;
  const skillSummary = s.by_skill
    .map((k) => `${k.code}=${fmtNum(k.hours)}`)
    .join('  ');
  const topText = s.top_skill
    ? `ทักษะเด่น ${s.top_skill.code} ${s.top_skill.name}`
    : '';

  return [
    para(run('ผู้นำองค์กรนิสิต', { bold: true, size: 28 }), {
      spacing: { before: 220, after: 60 },
    }),
    orgTable,
    para(run('สรุปรวม', { bold: true, size: 28 }), {
      spacing: { before: 160, after: 40 },
    }),
    para([
      run('จำนวนชั่วโมงที่ผ่าน: ', { bold: true, size: 28 }),
      run(`${fmtNum(s.total_hours)} ชม.`, { size: 28 }),
    ]),
    para([
      run('ทักษะที่ได้: ', { bold: true, size: 28 }),
      run(skillSummary, { size: 28 }),
    ]),
    topText ? para(run(topText, { size: 28, bold: true })) : para(run('', {})),
  ];
}

function buildLegendAndSign(data) {
  const statusLegend = [
    'A: ผู้รับผิดชอบโครงการ',
    'B: ผู้ดำเนินโครงการ',
    'C: ผู้เข้าร่วมกิจกรรม',
  ];
  const skillLegend = data.summary.by_skill.map((k) => `${k.code}: ${k.name}`);

  const legendCell = (title, lines) =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      children: [
        para(run(title, { bold: true, size: 26 })),
        ...lines.map((l) => para(run(l, { size: 26 }))),
      ],
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });

  const legendTable = new Table({
    width: fullWidth(),
    rows: [
      new TableRow({
        children: [
          legendCell('สถานภาพ', statusLegend),
          legendCell('ทักษะที่ได้รับการพัฒนา', skillLegend),
        ],
      }),
    ],
  });

  return [
    para(run('', {}), { spacing: { before: 200 } }),
    legendTable,
    para(run('รับรองสำเนาเอกสารถูกต้อง', { size: 26 }), {
      alignment: AlignmentType.RIGHT,
      spacing: { before: 240 },
    }),
    para(run(`(ลงชื่อ) ${BLANK}`, { size: 26 }), {
      alignment: AlignmentType.RIGHT,
      spacing: { before: 120 },
    }),
    para(run('รองอธิการบดีฝ่ายบริหารและพัฒนาศักยภาพองค์กร', { size: 26 }), {
      alignment: AlignmentType.RIGHT,
    }),
    para(run('วันที่ ......... เดือน ................... พ.ศ. ............', { size: 26 }), {
      alignment: AlignmentType.RIGHT,
    }),
  ];
}

// ── public: สร้าง Buffer ของ .docx ────────────────────────────────────────
//   data = ผลจาก getTranscriptData; overrides = ค่าจากฟอร์ม (ทับ header ชั่วคราว)
export async function buildTranscriptDocx(data, overrides = {}) {
  const header = { ...data.header };
  for (const k of ['major_name', 'degree_name', 'admission_date', 'name_en_full']) {
    if (overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== '') {
      header[k] = overrides[k];
    }
  }

  const children = [
    ...buildHeader(),
    ...buildStudentInfo(header),
  ];

  if (data.years.length === 0) {
    children.push(
      para(run('— ยังไม่มีกิจกรรมที่ผ่านเกณฑ์ —', { size: 28, italics: true }), {
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 },
      }),
    );
  } else {
    for (const year of data.years) children.push(...buildYearTable(year));
  }

  children.push(...buildOrgLeaderAndSummary(data));
  children.push(...buildLegendAndSign(data));

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 28 } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
