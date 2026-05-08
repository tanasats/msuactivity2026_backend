// ปีการศึกษามหาวิทยาลัยมหาสารคาม: ภาคต้น (สิงหาคม) → ภาคปลาย → ภาคฤดูร้อน (กรกฎาคม)
// คืนปีการศึกษาเป็น พ.ศ. 4 หลัก ตาม schema activities.academic_year (ดู memory: project_activity_code)
//
// rule: เดือน >= 8 (ส.ค.) → ปี ค.ศ. ปัจจุบัน + 543 = academic year (BE)
//       เดือน <= 7        → ปี ค.ศ. ปัจจุบัน - 1 + 543 = academic year (BE)
//
// ตัวอย่าง: 6 พ.ค. 2026 (เดือน 5) → 2025 - 1 + 543 = ปีการศึกษา 2568
//          1 ส.ค. 2026 (เดือน 8) → 2026 + 543 = ปีการศึกษา 2569
export function getCurrentAcademicYearBE(now = new Date()) {
  const month = now.getMonth() + 1; // 1..12
  const yearAD = now.getFullYear();
  const baseAD = month >= 8 ? yearAD : yearAD - 1;
  return baseAD + 543;
}
