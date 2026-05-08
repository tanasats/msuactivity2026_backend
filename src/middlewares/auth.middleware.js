import { verifyAccessToken } from '../utils/jwt.js';

// roles ที่มีสิทธิ์ใช้งานระบบจริง (ไม่รวม staff ซึ่งเป็น default landing role ที่ยังไม่ได้ provision)
// ใช้ในการอนุญาตให้อ่านข้อมูลส่วนกลาง เช่น master data
export const ACTIVE_ROLES = Object.freeze([
  'student',
  'faculty_staff',
  'executive',
  'admin',
  'super_admin',
]);

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'missing bearer token' });
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = await verifyAccessToken(token);
    req.user = {
      id: Number(payload.sub),
      role: payload.role,
      faculty_id: payload.faculty_id ?? null,
    };
    next();
  } catch {
    return res
      .status(401)
      .json({ status: 'error', message: 'invalid or expired access token' });
  }
}

// requireRole('admin', 'super_admin') — whitelist explicit
// ห้ามใช้แนว hierarchical เพราะ role ของระบบนี้ไม่เรียงตามอำนาจตรงๆ
// (executive มี scope กว้างที่สุด แต่ read-only — แค่ "ใหญ่กว่า" ไม่ได้)
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'unauthenticated' });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: `forbidden — ต้องการ role: ${allowed.join('/')}`,
      });
    }
    next();
  };
}
