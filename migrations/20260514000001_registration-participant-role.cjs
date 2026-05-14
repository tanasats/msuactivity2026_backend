/* eslint-disable camelcase */

// participant_role — สถานภาพของนิสิตที่เข้าร่วม "ในกิจกรรมนั้น" (อิสระจาก users.role)
//   PARTICIPANT — ผู้เข้าร่วมกิจกรรม (default ทุก row)
//   ORGANIZER  — ผู้ดำเนินโครงการ
//   LEADER     — ผู้รับผิดชอบโครงการ
//
// Approach A: label เฉยๆ — ไม่กระทบสูตรชั่วโมง (จะมาเพิ่ม multiplier ภายหลังได้
// เพราะเป็น additive)
//
// ใครเปลี่ยนได้: ผู้สร้างกิจกรรม + admin + super_admin

exports.up = (pgm) => {
  pgm.createType('participant_role', ['PARTICIPANT', 'ORGANIZER', 'LEADER']);
  pgm.addColumns('registrations', {
    participant_role: {
      type: 'participant_role',
      notNull: true,
      default: 'PARTICIPANT',
    },
  });
  // ใช้ query บ่อย: นิสิตที่ไม่ใช่ PARTICIPANT (ORGANIZER/LEADER) ของกิจกรรมหนึ่งๆ
  // — partial index ประหยัด เพราะ majority ของ row จะเป็น PARTICIPANT
  pgm.createIndex('registrations', ['activity_id', 'participant_role'], {
    name: 'idx_registrations_non_participant_role',
    where: "participant_role <> 'PARTICIPANT'",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('registrations', ['activity_id', 'participant_role'], {
    name: 'idx_registrations_non_participant_role',
  });
  pgm.dropColumns('registrations', ['participant_role']);
  pgm.dropType('participant_role');
};
