// แคตตาล็อกเหตุการณ์แจ้งเตือน — รวมศูนย์ที่เดียว (ดู docs/notifications-design.md §4–5)
//
// แต่ละ event นิยาม:
//   category           — จับคู่ preference + ไอคอนฝั่ง UI
//   resolveRecipients  — (ctx) → [{ id, email? }]  (async ได้ — บางอันต้อง query DB)
//   render             — (ctx) → { title, body, link_url?, related_activity_id?,
//                                  related_registration_id?, dedupe_key? }
//     dedupe_key เป็น "base" (ไม่มี user) — channel จะต่อ ":{userId}" ให้เป็น unique ต่อผู้รับ
//
// ctx ที่ wiring ส่งมา (มาตรฐาน): { userId?, activity?, registration?, certificate?, ... }

import { getActiveUsersByRole } from '../models/notification.model.js';

// ── หมวด (category) + role ที่เห็น + ค่า default ต่อช่องทาง ──────────
export const CHANNELS = ['in_app', 'email'];

export const CATEGORIES = {
  registration: {
    label: 'สถานะการสมัคร',
    roles: ['student'],
    default: { in_app: true, email: false },
  },
  attendance: {
    label: 'การเช็คอิน / ผลประเมิน',
    roles: ['student'],
    default: { in_app: true, email: false },
  },
  certificate: {
    label: 'ใบรับรอง / Transcript',
    roles: ['student'],
    default: { in_app: true, email: false },
  },
  activity_reminder: {
    label: 'เตือนก่อนกิจกรรม / กิจกรรมเปลี่ยนแปลง',
    roles: ['student'],
    default: { in_app: true, email: false },
  },
  interest_reminder: {
    label: 'กิจกรรมที่สนใจใกล้เปิดรับสมัคร',
    roles: ['student'],
    default: { in_app: true, email: false },
  },
  activity_workflow: {
    label: 'ความเคลื่อนไหวกิจกรรมที่ฉันสร้าง',
    roles: ['faculty_staff'],
    default: { in_app: true, email: true },
  },
  approval_queue: {
    label: 'งานรออนุมัติ',
    roles: ['admin', 'super_admin'],
    default: { in_app: true, email: false },
  },
  exec_digest: {
    label: 'สรุปภาพรวม',
    roles: ['executive'],
    default: { in_app: false, email: true },
  },
  announcement: {
    label: 'ข่าวสาร / ประกาศ',
    roles: ['student', 'faculty_staff', 'executive', 'admin', 'super_admin', 'staff'],
    default: { in_app: true, email: false },
    channels: ['in_app'], // broadcast in-app เท่านั้น — ไม่มี email
  },
  message: {
    label: 'ข้อความติดต่อ (คณะ ↔ ผู้ดูแล)',
    roles: ['faculty_staff', 'admin', 'super_admin'],
    default: { in_app: true, email: false },
    channels: ['in_app'], // v1 in-app เท่านั้น
  },
};

// ช่องทางที่หมวดนี้ "ส่งได้จริง" (default = ทุกช่องทาง) — ใช้ซ่อน toggle ที่ไม่มีผล
export function categoryChannels(category) {
  return CATEGORIES[category]?.channels ?? CHANNELS;
}

// ── helper: format วันเวลาแบบไทย (Asia/Bangkok, พ.ศ.) ──────────────
const dtFmt = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Bangkok',
});
const fmt = (iso) => (iso ? dtFmt.format(new Date(iso)) : '');

// ผู้รับ = เจ้าของ registration/ผู้ใช้ตรง ๆ
const toUser = (ctx) => [{ id: ctx.userId }];
// ผู้รับ = เจ้าของกิจกรรม (faculty_staff ผู้สร้าง)
const toActivityOwner = (ctx) =>
  ctx.activity?.created_by ? [{ id: ctx.activity.created_by }] : [];

// ── แคตตาล็อก event ──────────────────────────────────────────────
export const EVENTS = {
  // ===== นิสิต =====
  'registration.approved': {
    category: 'registration',
    resolveRecipients: toUser,
    render: (ctx) => ({
      title: 'การสมัครได้รับอนุมัติ',
      body: `คุณได้รับอนุมัติให้เข้าร่วม "${ctx.activity?.title ?? 'กิจกรรม'}"`,
      link_url: `/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      related_registration_id: ctx.registration?.id,
      dedupe_key: `registration.approved:${ctx.registration?.id}`,
    }),
  },
  'registration.rejected': {
    category: 'registration',
    resolveRecipients: toUser,
    render: (ctx) => ({
      title: 'การสมัครถูกปฏิเสธ',
      body: `การสมัคร "${ctx.activity?.title ?? 'กิจกรรม'}" ถูกปฏิเสธ${
        ctx.reason ? ` — เหตุผล: ${ctx.reason}` : ''
      }`,
      link_url: `/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      related_registration_id: ctx.registration?.id,
      dedupe_key: `registration.rejected:${ctx.registration?.id}`,
    }),
  },
  'registration.promoted': {
    category: 'registration',
    resolveRecipients: toUser,
    render: (ctx) => ({
      title: 'เลื่อนจากคิวสำรองเข้าร่วมแล้ว',
      body: `คุณถูกเลื่อนจากคิวสำรองเข้าร่วม "${ctx.activity?.title ?? 'กิจกรรม'}" เรียบร้อย`,
      link_url: `/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      related_registration_id: ctx.registration?.id,
      dedupe_key: `registration.promoted:${ctx.registration?.id}`,
    }),
  },
  'registration.confirmed': {
    category: 'registration',
    resolveRecipients: toUser,
    render: (ctx) => ({
      title: 'สมัครเข้าร่วมสำเร็จ',
      body: `ยืนยันการสมัคร "${ctx.activity?.title ?? 'กิจกรรม'}" — จัด ${fmt(
        ctx.activity?.start_at,
      )}`,
      link_url: `/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      related_registration_id: ctx.registration?.id,
      dedupe_key: `registration.confirmed:${ctx.registration?.id}`,
    }),
  },

  'attendance.checked_in': {
    category: 'attendance',
    resolveRecipients: toUser,
    render: (ctx) => ({
      title: 'เช็คอินสำเร็จ',
      body: `บันทึกการเข้าร่วม "${ctx.activity?.title ?? 'กิจกรรม'}" แล้ว`,
      link_url: `/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      related_registration_id: ctx.registration?.id,
      dedupe_key: `attendance.checked_in:${ctx.registration?.id}`,
    }),
  },
  'attendance.evaluated': {
    category: 'attendance',
    resolveRecipients: toUser,
    render: (ctx) => {
      const passed = ctx.result === 'PASSED';
      return {
        title: passed ? 'ผ่านการประเมินกิจกรรม' : 'ผลประเมิน: ไม่ผ่าน',
        body: passed
          ? `"${ctx.activity?.title ?? 'กิจกรรม'}" ผ่านการประเมิน — นับชั่วโมงกิจกรรมแล้ว`
          : `"${ctx.activity?.title ?? 'กิจกรรม'}" ไม่ผ่านการประเมิน`,
        link_url: `/activities/${ctx.activity?.id}`,
        related_activity_id: ctx.activity?.id,
        related_registration_id: ctx.registration?.id,
        dedupe_key: `attendance.evaluated:${ctx.registration?.id}:${ctx.result}`,
      };
    },
  },

  'certificate.approved': {
    category: 'certificate',
    resolveRecipients: toUser,
    render: (ctx) => ({
      title: 'คำขอใบรับรองได้รับอนุมัติ',
      body: 'คำขอ Transcript กิจกรรมของคุณได้รับอนุมัติแล้ว',
      link_url: '/dashboard/student/certificates',
      dedupe_key: `certificate.approved:${ctx.certificate?.id}`,
    }),
  },
  'certificate.issued': {
    category: 'certificate',
    resolveRecipients: toUser,
    render: (ctx) => ({
      title: 'ใบรับรองพร้อมดาวน์โหลด',
      body: 'Transcript กิจกรรมของคุณออกเรียบร้อย — ดาวน์โหลดได้แล้ว',
      link_url: '/dashboard/student/certificates',
      dedupe_key: `certificate.issued:${ctx.certificate?.id}`,
    }),
  },
  'certificate.rejected': {
    category: 'certificate',
    resolveRecipients: toUser,
    render: (ctx) => ({
      title: 'คำขอใบรับรองถูกปฏิเสธ',
      body: `คำขอ Transcript ถูกปฏิเสธ${ctx.reason ? ` — เหตุผล: ${ctx.reason}` : ''}`,
      link_url: '/dashboard/student/certificates',
      dedupe_key: `certificate.rejected:${ctx.certificate?.id}`,
    }),
  },

  // ===== เจ้าหน้าที่คณะ (ผู้สร้างกิจกรรม) =====
  'activity.approved': {
    category: 'activity_workflow',
    resolveRecipients: toActivityOwner,
    render: (ctx) => ({
      title: 'กิจกรรมได้รับอนุมัติ',
      body: `"${ctx.activity?.title ?? 'กิจกรรม'}" ได้รับอนุมัติ${
        ctx.activity?.code ? ` (รหัส ${ctx.activity.code})` : ''
      }`,
      link_url: `/dashboard/faculty/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      dedupe_key: `activity.approved:${ctx.activity?.id}`,
    }),
  },
  'activity.rejected': {
    category: 'activity_workflow',
    resolveRecipients: toActivityOwner,
    render: (ctx) => ({
      title: 'กิจกรรมถูกปฏิเสธ',
      body: `"${ctx.activity?.title ?? 'กิจกรรม'}" ถูกปฏิเสธ${
        ctx.reason ? ` — เหตุผล: ${ctx.reason}` : ''
      }`,
      link_url: `/dashboard/faculty/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      dedupe_key: `activity.rejected:${ctx.activity?.id}`,
    }),
  },
  'activity.full': {
    category: 'activity_workflow',
    resolveRecipients: toActivityOwner,
    render: (ctx) => ({
      title: 'กิจกรรมมีผู้สมัครเต็มแล้ว',
      body: `"${ctx.activity?.title ?? 'กิจกรรม'}" มีผู้สมัครครบตามจำนวนที่รับ`,
      link_url: `/dashboard/faculty/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      dedupe_key: `activity.full:${ctx.activity?.id}`,
    }),
  },
  'activity.registration_pending': {
    category: 'activity_workflow',
    resolveRecipients: toActivityOwner,
    render: (ctx) => ({
      title: 'มีผู้สมัครรออนุมัติ',
      body: `มีนิสิตสมัคร "${ctx.activity?.title ?? 'กิจกรรม'}" รอการอนุมัติ`,
      link_url: `/dashboard/faculty/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      related_registration_id: ctx.registration?.id,
      dedupe_key: `activity.registration_pending:${ctx.registration?.id}`,
    }),
  },

  // ===== admin / super_admin =====
  'activity.pending_approval': {
    category: 'approval_queue',
    resolveRecipients: () => getActiveUsersByRole(['admin', 'super_admin']),
    render: (ctx) => ({
      title: 'มีกิจกรรมรออนุมัติ',
      body: `"${ctx.activity?.title ?? 'กิจกรรม'}" ส่งขออนุมัติ`,
      link_url: `/dashboard/admin/activities/${ctx.activity?.id}`,
      related_activity_id: ctx.activity?.id,
      dedupe_key: `activity.pending_approval:${ctx.activity?.id}`,
    }),
  },
  'certificate.requested': {
    category: 'approval_queue',
    resolveRecipients: () => getActiveUsersByRole(['admin', 'super_admin']),
    render: (ctx) => ({
      title: 'มีคำขอใบรับรองใหม่',
      body: `${ctx.studentName ?? 'นิสิต'} ยื่นขอ Transcript กิจกรรม`,
      link_url: '/dashboard/admin/certificates',
      dedupe_key: `certificate.requested:${ctx.certificate?.id}`,
    }),
  },

  // ===== ข้อความสองทาง faculty ↔ admin (alert) =====
  //   link ต่างกันตาม role ผู้รับ → แยก 2 event (แต่ละอันฝัง link ฝั่งตัวเอง)
  'message.to_admins': {
    category: 'message',
    resolveRecipients: () => getActiveUsersByRole(['admin', 'super_admin']),
    render: (ctx) => ({
      title: `ข้อความจากคณะ: ${ctx.subject ?? ''}`.trim(),
      body: `${ctx.senderName ?? 'เจ้าหน้าที่คณะ'}: ${ctx.preview ?? ''}`,
      link_url: `/dashboard/admin/inbox/${ctx.threadId}`,
      dedupe_key: `message.to_admins:${ctx.messageId}`,
    }),
  },
  'message.to_faculty': {
    category: 'message',
    resolveRecipients: (ctx) => (ctx.createdBy ? [{ id: ctx.createdBy }] : []),
    render: (ctx) => ({
      title: `ผู้ดูแลตอบ: ${ctx.subject ?? ''}`.trim(),
      body: `${ctx.senderName ?? 'ผู้ดูแล'}: ${ctx.preview ?? ''}`,
      link_url: `/dashboard/faculty/messages/${ctx.threadId}`,
      dedupe_key: `message.to_faculty:${ctx.messageId}`,
    }),
  },

  // ===== ทุกคน =====
  // หมายเหตุ: "ประกาศ" (announcement) ไม่ใช้ emit/fan-out ต่อผู้ใช้ (39k) —
  //   ทำเป็น broadcast: เก็บ 1 แถวใน announcements + read-state (announcement_reads)
  //   กระดิ่งผสมประกาศ active เข้ากับ notification ส่วนตัวเอง (ดู notification.controller)
  //   หมวด 'announcement' ยังมีใน CATEGORIES ไว้คุม toggle in-app ของ broadcast
};

// default ของ (category, channel) — ใช้ตอน resolve preference ถ้าผู้ใช้ไม่ override
export function categoryDefault(category, channel) {
  return CATEGORIES[category]?.default?.[channel] ?? true;
}
