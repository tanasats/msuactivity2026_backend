import nodemailer from 'nodemailer';

// ── transport layer สำหรับส่งอีเมล (เฟส 4) ───────────────────────
//   เริ่มต้นด้วย SMTP + App Password ของ Gmail/Workspace (เช่น dev@msu.ac.th)
//   ออกแบบให้สลับ transport ได้ภายหลัง (Workspace service account / SES / SendGrid)
//   โดยไม่ต้องแก้ผู้เรียก — แค่เปลี่ยน buildTransport()
//
// env ที่ใช้:
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 587),
//   SMTP_USER, SMTP_PASS (App Password 16 ตัว), EMAIL_FROM

let transporter = null;

function buildTransport() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  // App Password มักถูก copy มาพร้อมเว้นวรรค (แสดงเป็น 4 กลุ่ม) — strip ออกให้ auth ผ่าน
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, '');
  if (!user || !pass) {
    throw new Error('ยังไม่ได้ตั้ง SMTP_USER / SMTP_PASS ใน .env');
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user, pass },
    // timeout กันค้าง (สไตล์เดียวกับ erp-client)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function getTransport() {
  if (!transporter) transporter = buildTransport();
  return transporter;
}

// from address — default = SMTP_USER ถ้าไม่ตั้ง EMAIL_FROM
function fromAddress() {
  return process.env.EMAIL_FROM || process.env.SMTP_USER;
}

// ตรวจการเชื่อมต่อ SMTP (login ผ่านไหม) — ใช้ตอน smoke test / endpoint ทดสอบ
export async function verifyTransport() {
  return getTransport().verify();
}

// ส่งอีเมล 1 ฉบับ — คืน { messageId } เมื่อสำเร็จ, throw เมื่อพลาด
//   ผู้เรียก (email worker) รับผิดชอบ retry/backoff เอง
//   ★ EMAIL_REDIRECT_ALL (dev safety): ถ้าตั้งไว้ → เปลี่ยนปลายทางทุกฉบับไปที่อีเมลนั้น
//     กันส่งหาผู้ใช้จริง (dev DB มีอีเมล production จริง) — เติม prefix บอกผู้รับเดิมใน subject
export async function sendMail({ to, subject, html, text }) {
  const redirect = process.env.EMAIL_REDIRECT_ALL?.trim();
  const actualTo = redirect || to;
  const actualSubject = redirect ? `[DEV→${to}] ${subject}` : subject;
  const info = await getTransport().sendMail({
    from: fromAddress(),
    to: actualTo,
    subject: actualSubject,
    html,
    text,
  });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}
