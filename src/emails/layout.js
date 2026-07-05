// wrapper HTML กลางของอีเมลแจ้งเตือน (ไทย) — ใช้ output ของ catalog render ({title, body, link_url})
//   เฟส 4 ใช้ template กลางตัวเดียว (source of truth เดียวกับ in-app) — เพิ่ม template รายชนิดทีหลังได้

const escapeHtml = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// รับ rendered ({ title, body, link_url }) → { subject, html, text }
export function renderEmail(rendered) {
  const appUrl = process.env.APP_PUBLIC_URL || 'http://localhost:3000';
  const settingsUrl = `${appUrl}/settings/notifications`;
  const linkUrl = rendered.link_url ? `${appUrl}${rendered.link_url}` : appUrl;
  const title = rendered.title ?? 'การแจ้งเตือน';
  const body = rendered.body ?? '';

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans Thai',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#2563eb;color:#fff;padding:16px 24px;border-radius:16px 16px 0 0;font-weight:700;">
      ระบบกิจกรรมนิสิต มมส.
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:0;">
      <h1 style="margin:0 0 12px;font-size:18px;color:#111827;">${escapeHtml(title)}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(body)}</p>
      <a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">
        เปิดดูในระบบ
      </a>
    </div>
    <div style="background:#fff;padding:16px 24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;font-size:12px;color:#9ca3af;">
      คุณได้รับอีเมลนี้เพราะเปิดรับการแจ้งเตือนไว้ —
      <a href="${escapeHtml(settingsUrl)}" style="color:#6b7280;">จัดการการแจ้งเตือน</a>
    </div>
  </div>
</body></html>`;

  const text = `${title}\n\n${body}\n\nเปิดดูในระบบ: ${linkUrl}\n\n— ระบบกิจกรรมนิสิต มมส.\nจัดการการแจ้งเตือน: ${settingsUrl}`;

  return { subject: title, html, text };
}
