import 'dotenv/config';
import { verifyTransport, sendMail } from '../src/utils/mailer.js';

// สคริปต์ทดสอบส่งอีเมล (เฟส 4 ขั้นที่ 2) — ยืนยันว่า SMTP + App Password ใช้ได้
//   ใช้:  node scripts/test-email.js ผู้รับ@example.com
//   อ่าน SMTP_* จาก .env (สคริปต์นี้ไม่เห็น/ไม่ log รหัส)

const to = process.argv[2];
if (!to) {
  console.error('ระบุอีเมลผู้รับ:  node scripts/test-email.js you@example.com');
  process.exit(1);
}

console.log(`SMTP: ${process.env.SMTP_USER}@${process.env.SMTP_HOST || 'smtp.gmail.com'}:${process.env.SMTP_PORT || 587}`);

try {
  process.stdout.write('1) verify การเชื่อมต่อ SMTP... ');
  await verifyTransport();
  console.log('✔ ผ่าน (login สำเร็จ)');

  process.stdout.write(`2) ส่งเมลทดสอบไป ${to}... `);
  const res = await sendMail({
    to,
    subject: '[MSU Activity] ทดสอบระบบส่งอีเมล',
    text: 'นี่คืออีเมลทดสอบจากระบบกิจกรรมนิสิต มมส. — ถ้าได้รับแสดงว่า SMTP ใช้งานได้',
    html: '<p>นี่คืออีเมลทดสอบจาก <b>ระบบกิจกรรมนิสิต มมส.</b></p><p>ถ้าคุณได้รับ แสดงว่าการตั้งค่า SMTP + App Password ใช้งานได้ ✅</p>',
  });
  console.log('✔ ส่งแล้ว');
  console.log('   messageId:', res.messageId);
  console.log('   accepted :', res.accepted);
  process.exit(0);
} catch (err) {
  console.log('�’ ล้มเหลว');
  console.error('   error:', err.message);
  process.exit(1);
}
