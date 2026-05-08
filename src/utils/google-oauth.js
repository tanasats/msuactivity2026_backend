import { OAuth2Client } from 'google-auth-library';

const HOSTED_DOMAIN = 'msu.ac.th';

let _client;
function getClient() {
  if (!_client) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      const err = new Error(
        'Google OAuth ยังไม่ได้ตั้งค่า — ต้องตั้ง GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ' +
          'GOOGLE_REDIRECT_URI ใน backend/.env แล้วรีสตาร์ท backend',
      );
      err.status = 500;
      throw err;
    }
    _client = new OAuth2Client({ clientId, clientSecret, redirectUri });
  }
  return _client;
}

export function buildAuthUrl(state) {
  return getClient().generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    access_type: 'online',
    prompt: 'select_account',
    hd: HOSTED_DOMAIN,
    state,
  });
}

export async function exchangeCodeForUser(code) {
  const client = getClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    const err = new Error('Google did not return id_token');
    err.status = 502;
    throw err;
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  // บังคับ hosted domain — ID token verification เท่านั้นที่เชื่อถือได้
  // (param hd ใน auth URL เป็นแค่ UI hint, ปลอมได้)
  if (payload.hd !== HOSTED_DOMAIN) {
    const err = new Error(`อนุญาตเฉพาะอีเมล @${HOSTED_DOMAIN} เท่านั้น`);
    err.status = 403;
    throw err;
  }
  if (!payload.email_verified) {
    const err = new Error('Google email ยังไม่ได้ verify');
    err.status = 403;
    throw err;
  }

  return {
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
    google_sub: payload.sub,
    picture_url: payload.picture || null,
    google_access_token: tokens.access_token || null,  // ใช้เรียก ERP, ไม่เก็บใน DB
  };
}
