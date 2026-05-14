/* eslint-disable camelcase */

// ── Tier 1 DB tuning: เพิ่ม btree index บน FK columns ที่ขาด ─────────
//
// ปัญหา: Postgres สร้าง index อัตโนมัติให้ PRIMARY KEY (ฝั่ง referenced)
//        แต่ไม่สร้างให้ FK column (ฝั่ง referencing) — เป็นความรับผิดชอบของ schema designer
//
// ผลกระทบที่หาย:
//   1. ON DELETE RESTRICT/SET NULL ไม่ต้อง seq-scan ทั้งตาราง — สำคัญตอนลบ user/category
//   2. reverse lookup เร็วขึ้น (เช่น "กิจกรรมทั้งหมดที่ user X อนุมัติ")
//   3. JOIN plan ดีขึ้นเมื่อข้อมูลโต
//
// 16 FK ที่ขาด — แบ่งกลุ่มเพื่ออ่านง่าย:
//   audit FKs ใน activities/registrations/attendances/etc → users
//   master data FKs (category_id, faculty_id, skill_id) → reference tables
//   announcement created_by/updated_by → users

exports.up = (pgm) => {
  // ── audit FK → users ─────────────────────────────────────────────
  pgm.createIndex('activities', 'approved_by', {
    name: 'idx_activities_approved_by',
  });
  pgm.createIndex('activity_files', 'uploaded_by', {
    name: 'idx_activity_files_uploaded_by',
  });
  pgm.createIndex('attendances', 'checked_in_by', {
    name: 'idx_attendances_checked_in_by',
  });
  pgm.createIndex('registrations', 'approved_by', {
    name: 'idx_registrations_approved_by',
  });
  pgm.createIndex('registrations', 'cancelled_by', {
    name: 'idx_registrations_cancelled_by',
  });
  pgm.createIndex('registrations', 'evaluated_by', {
    name: 'idx_registrations_evaluated_by',
  });
  pgm.createIndex('registrations', 'rejected_by', {
    name: 'idx_registrations_rejected_by',
  });
  pgm.createIndex('certificates', 'reviewed_by', {
    name: 'idx_certificates_reviewed_by',
  });
  pgm.createIndex('cert_requirements', 'created_by', {
    name: 'idx_cert_requirements_created_by',
  });
  pgm.createIndex('system_settings', 'updated_by', {
    name: 'idx_system_settings_updated_by',
  });
  pgm.createIndex('announcements', 'created_by', {
    name: 'idx_announcements_created_by',
  });
  pgm.createIndex('announcements', 'updated_by', {
    name: 'idx_announcements_updated_by',
  });

  // ── master data FK → reference tables ────────────────────────────
  pgm.createIndex('activity_eligible_faculties', 'faculty_id', {
    name: 'idx_activity_eligible_faculties_faculty_id',
  });
  pgm.createIndex('activity_skills', 'skill_id', {
    name: 'idx_activity_skills_skill_id',
  });
  pgm.createIndex('activity_code_counters', 'category_id', {
    name: 'idx_activity_code_counters_category_id',
  });
  pgm.createIndex('cert_requirements', 'category_id', {
    name: 'idx_cert_requirements_category_id',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('cert_requirements', null, {
    name: 'idx_cert_requirements_category_id',
  });
  pgm.dropIndex('activity_code_counters', null, {
    name: 'idx_activity_code_counters_category_id',
  });
  pgm.dropIndex('activity_skills', null, {
    name: 'idx_activity_skills_skill_id',
  });
  pgm.dropIndex('activity_eligible_faculties', null, {
    name: 'idx_activity_eligible_faculties_faculty_id',
  });
  pgm.dropIndex('announcements', null, { name: 'idx_announcements_updated_by' });
  pgm.dropIndex('announcements', null, { name: 'idx_announcements_created_by' });
  pgm.dropIndex('system_settings', null, {
    name: 'idx_system_settings_updated_by',
  });
  pgm.dropIndex('cert_requirements', null, {
    name: 'idx_cert_requirements_created_by',
  });
  pgm.dropIndex('certificates', null, { name: 'idx_certificates_reviewed_by' });
  pgm.dropIndex('registrations', null, {
    name: 'idx_registrations_rejected_by',
  });
  pgm.dropIndex('registrations', null, {
    name: 'idx_registrations_evaluated_by',
  });
  pgm.dropIndex('registrations', null, {
    name: 'idx_registrations_cancelled_by',
  });
  pgm.dropIndex('registrations', null, {
    name: 'idx_registrations_approved_by',
  });
  pgm.dropIndex('attendances', null, { name: 'idx_attendances_checked_in_by' });
  pgm.dropIndex('activity_files', null, {
    name: 'idx_activity_files_uploaded_by',
  });
  pgm.dropIndex('activities', null, { name: 'idx_activities_approved_by' });
};
