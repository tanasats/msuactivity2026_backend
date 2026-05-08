import crypto from 'node:crypto';
import { buildAuthUrl, exchangeCodeForUser } from '../utils/google-oauth.js';
import { fetchStaffInfo } from '../utils/erp-client.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ttlToMs,
} from '../utils/jwt.js';
import * as users from '../models/user.model.js';
import * as refreshTokens from '../models/refresh-token.model.js';

const REFRESH_COOKIE = 'rt';
const STATE_COOKIE = 'oauth_state';
const REFRESH_TTL_MS = ttlToMs(process.env.JWT_REFRESH_TTL || '30d');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
};

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieBase,
    maxAge: REFRESH_TTL_MS,
    path: '/api/auth',
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase, path: '/api/auth' });
}

function publicUserFields(u) {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    faculty_id: u.faculty_id,
    faculty_name: u.faculty_name,
    msu_id: u.msu_id,
    picture_url: u.picture_url,
    staff_id: u.staff_id,
    position_th: u.position_th,
    phone: u.phone,
    erp_faculty_name: u.erp_faculty_name,
    erp_department_name: u.erp_department_name,
    erp_program_name: u.erp_program_name,
  };
}

export async function getAuthUrl(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    ...cookieBase,
    maxAge: 10 * 60 * 1000,
    path: '/api/auth/google/callback',
  });
  res.json({ url: buildAuthUrl(state) });
}

export async function googleCallback(req, res) {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).json({ status: 'error', message: 'missing code' });
  }
  if (!state || state !== req.cookies?.[STATE_COOKIE]) {
    return res.status(403).json({ status: 'error', message: 'invalid state (CSRF protection)' });
  }
  res.clearCookie(STATE_COOKIE, { ...cookieBase, path: '/api/auth/google/callback' });

  const profile = await exchangeCodeForUser(code);
  // profile = { email, name, google_sub, picture_url, google_access_token }

  let user = await users.findByEmail(profile.email);
  if (!user) {
    // ทุกคนที่ login ผ่าน Google Workspace @msu.ac.th ได้จะถูก provision อัตโนมัติ:
    //   - email รูปแบบรหัสนิสิต 11 หลัก → role=student (สิทธิ์ใช้งานครบ)
    //   - email อื่นๆ                   → role=staff (default ไม่มีสิทธิ์, รอยกระดับโดย admin)
    const role = users.detectRoleFromEmail(profile.email);
    const msuId = users.extractMsuId(profile.email);

    // เฉพาะครั้งแรก: derive faculty_id จากรหัสนิสิตตำแหน่งที่ 5-6
    // (ครั้งหลังไม่ overwrite เพราะ admin อาจแก้ manual ภายหลัง)
    let facultyId = null;
    if (role === 'student' && msuId) {
      const facultyCode = users.extractFacultyCodeFromMsuId(msuId);
      facultyId = await users.findFacultyIdByCode(facultyCode);
      if (!facultyId) {
        console.warn(
          `[auth] student msu_id=${msuId} maps to unknown faculty code=${facultyCode} — leaving faculty_id NULL`,
        );
      }
    }

    user = await users.createUser({
      email: profile.email,
      full_name: profile.name,
      role,
      msu_id: msuId,
      faculty_id: facultyId,
      google_sub: profile.google_sub,
      picture_url: profile.picture_url,
    });
  } else {
    // sync google_sub + picture เผื่อเปลี่ยน (ผู้ใช้เปลี่ยนรูปโปรไฟล์ Google)
    await users.updateGoogleProfile(user.id, {
      google_sub: profile.google_sub,
      picture_url: profile.picture_url,
    });
  }

  if (user.status !== 'active') {
    return res.status(403).json({
      status: 'error',
      message: 'บัญชีถูกระงับการใช้งาน',
    });
  }

  // ดึง staff info จาก ERP สำหรับ non-student (best-effort, ไม่บล็อก login ถ้า fail)
  if (user.role !== 'student' && profile.google_access_token) {
    try {
      const staffInfo = await fetchStaffInfo(profile.google_access_token);
      await users.syncStaffProfileFromErp(user.id, staffInfo);

      // map erp_faculty_name → faculties.id (เฉพาะถ้ายังไม่มี faculty_id)
      // — เคารพการตั้งค่าด้วยมือของ admin ที่อาจ set ไปก่อน
      if (!user.faculty_id && staffInfo?.facultyname) {
        const matchedId = await users.findFacultyIdByName(staffInfo.facultyname);
        if (matchedId) {
          await users.setFacultyId(user.id, matchedId);
        } else {
          console.warn(
            `[auth] ERP facultyname='${staffInfo.facultyname}' ไม่ตรงกับ faculties ใด — leaving faculty_id NULL`,
          );
        }
      }
    } catch (err) {
      console.warn(`[ERP sync failed for ${user.email}]`, err.message);
    }
  }

  await users.updateLastLogin(user.id);
  // refresh ข้อมูล user หลัง update (เพื่อให้ JWT/redirect มีค่าล่าสุด)
  user = await users.findById(user.id);

  const access = await signAccessToken({
    sub: user.id,
    role: user.role,
    faculty_id: user.faculty_id,
  });
  const jti = crypto.randomBytes(16).toString('hex');
  const refresh = await signRefreshToken({ sub: user.id, jti });

  await refreshTokens.storeRefreshToken({
    jti,
    user_id: user.id,
    expires_at: new Date(Date.now() + REFRESH_TTL_MS),
    user_agent: req.get('user-agent'),
    ip: req.ip,
  });

  setRefreshCookie(res, refresh);

  // ส่งกลับ frontend ผ่าน URL fragment — frontend page /auth/callback จะอ่าน
  // ใช้ fragment (#) แทน query (?) เพื่อให้ access token ไม่ถูก log โดย proxy/server
  const redirectUrl = `${FRONTEND_URL}/auth/callback#access_token=${encodeURIComponent(access)}`;
  res.redirect(redirectUrl);
}

export async function refresh(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'missing refresh token' });
  }

  let payload;
  try {
    payload = await verifyRefreshToken(token);
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ status: 'error', message: 'invalid refresh token' });
  }

  const stored = await refreshTokens.findRefreshToken(payload.jti);
  if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
    clearRefreshCookie(res);
    return res
      .status(401)
      .json({ status: 'error', message: 'refresh token revoked or expired' });
  }

  const user = await users.findById(Number(payload.sub));
  if (!user || user.status !== 'active') {
    clearRefreshCookie(res);
    return res.status(403).json({ status: 'error', message: 'user not active' });
  }

  const access = await signAccessToken({
    sub: user.id,
    role: user.role,
    faculty_id: user.faculty_id,
  });
  res.json({ access_token: access });
}

export async function logout(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = await verifyRefreshToken(token);
      await refreshTokens.revokeRefreshToken(payload.jti);
    } catch {
      // token invalid อยู่แล้ว — แค่ clear cookie
    }
  }
  clearRefreshCookie(res);
  res.json({ status: 'ok' });
}

export async function me(req, res) {
  const user = await users.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ status: 'error', message: 'user not found' });
  }
  res.json(publicUserFields(user));
}
