const ERP_STAFFINFO_URL = 'https://erp.msu.ac.th/service/api/staffinfo';
const ERP_TIMEOUT_MS = 5000;

/**
 * ดึง staff info จาก ERP MSU ด้วย Google access token
 * @returns ออบเจกต์ตาม shape ที่ ERP ส่งกลับใน data field
 * @throws Error (status 502) ถ้า request fail หรือ ERP ตอบ status:false
 */
export async function fetchStaffInfo(googleAccessToken) {
  if (!googleAccessToken) {
    const err = new Error('missing google access token');
    err.status = 400;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ERP_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ERP_STAFFINFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${googleAccessToken}` },
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(
      e.name === 'AbortError'
        ? `ERP timeout (${ERP_TIMEOUT_MS}ms)`
        : `ERP request failed: ${e.message}`,
    );
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`ERP returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const json = await res.json();
  if (!json.status || !json.data) {
    const err = new Error(`ERP responded with status:false (${json.message || 'unknown'})`);
    err.status = 502;
    throw err;
  }
  //console.log(json.data);
  return json.data;
}
