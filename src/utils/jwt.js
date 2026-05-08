import { SignJWT, jwtVerify } from 'jose';

const ACCESS_SECRET = new TextEncoder().encode(
  process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me-in-production-32chars-min',
);
const REFRESH_SECRET = new TextEncoder().encode(
  process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me-in-production-32chars-min',
);

const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d';

export async function signAccessToken({ sub, role, faculty_id }) {
  return new SignJWT({ role, faculty_id: faculty_id ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(sub))
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(ACCESS_SECRET);
}

export async function signRefreshToken({ sub, jti }) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(sub))
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(REFRESH_SECRET);
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, ACCESS_SECRET);
  return payload;
}

export async function verifyRefreshToken(token) {
  const { payload } = await jwtVerify(token, REFRESH_SECRET);
  return payload;
}

// แปลง TTL string ('30d', '15m') เป็น ms — ใช้ตอนตั้ง cookie maxAge และ DB expires_at
export function ttlToMs(ttl) {
  const match = String(ttl).match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`invalid TTL format: ${ttl}`);
  const n = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return n * unit;
}
