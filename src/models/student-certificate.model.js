import { pool, query } from '../db/index.js';

// ── student certificate model ────────────────────────────────────
//
// Eligibility = ผ่านครบ 3 ข้อตาม cert_requirements active rule:
//   1. count(activities prefix ∈ group_a) ≥ group_a_min_activities
//   2. count(activities prefix ∈ group_b) ≥ group_b_min_activities
//   3. sum(hours) ของทั้ง 2 กลุ่ม ≥ min_total_hours
//
// นับเฉพาะ registrations ที่ status='ATTENDED' AND evaluation_status='PASSED'
// กิจกรรมที่ code ขึ้นต้นด้วยตัวอักษรอื่น (เช่น 'H') หรือ code IS NULL → ตัดออก

// คำนวณ eligibility + breakdown ละเอียดสำหรับ user คนหนึ่ง
//   rule: row จาก cert_requirements (active)
//   คืน: { rule, group_a, group_b, hours, eligible, qualifying }
//     group_a/b: { actual_count, required_count, prefixes, met }
//     hours:     { actual, required, met }
//     eligible:  bool (ทั้ง 3 ผ่าน)
//     qualifying: { group_a: [...], group_b: [...] } — รายกิจกรรม (id, title, code, hours, prefix)
export async function computeEligibility(userId, rule) {
  const allPrefixes = [...rule.group_a_prefixes, ...rule.group_b_prefixes];
  // ดึงทุก qualifying activity ของนิสิตในรอบเดียว — group/sort ฝั่ง JS เร็วกว่าหลาย query
  const { rows } = await query(
    `SELECT a.id            AS activity_id,
            a.code,
            a.title,
            a.hours,
            a.start_at,
            LEFT(a.code, 1) AS prefix,
            CASE
              WHEN LEFT(a.code, 1) = ANY($2::text[]) THEN 'A'
              WHEN LEFT(a.code, 1) = ANY($3::text[]) THEN 'B'
              ELSE NULL
            END             AS grp
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
      WHERE r.user_id = $1
        AND r.status = 'ATTENDED'
        AND r.evaluation_status = 'PASSED'
        AND a.code IS NOT NULL
        AND LEFT(a.code, 1) = ANY($4::text[])
      ORDER BY a.start_at ASC, a.id ASC`,
    [userId, rule.group_a_prefixes, rule.group_b_prefixes, allPrefixes],
  );

  const groupA = rows.filter((r) => r.grp === 'A');
  const groupB = rows.filter((r) => r.grp === 'B');
  const totalHours = rows.reduce((sum, r) => sum + Number(r.hours), 0);

  const groupAMet = groupA.length >= rule.group_a_min_activities;
  const groupBMet = groupB.length >= rule.group_b_min_activities;
  const hoursMet = totalHours >= rule.min_total_hours;

  return {
    rule: {
      id: rule.id,
      group_a_prefixes: rule.group_a_prefixes,
      group_b_prefixes: rule.group_b_prefixes,
      group_a_min_activities: rule.group_a_min_activities,
      group_b_min_activities: rule.group_b_min_activities,
      min_total_hours: rule.min_total_hours,
      effective_from: rule.effective_from,
    },
    group_a: {
      prefixes: rule.group_a_prefixes,
      actual_count: groupA.length,
      required_count: rule.group_a_min_activities,
      met: groupAMet,
    },
    group_b: {
      prefixes: rule.group_b_prefixes,
      actual_count: groupB.length,
      required_count: rule.group_b_min_activities,
      met: groupBMet,
    },
    hours: {
      actual: totalHours,
      required: rule.min_total_hours,
      met: hoursMet,
    },
    eligible: groupAMet && groupBMet && hoursMet,
    qualifying: {
      group_a: groupA.map((r) => ({
        activity_id: r.activity_id,
        code: r.code,
        title: r.title,
        hours: Number(r.hours),
        prefix: r.prefix,
      })),
      group_b: groupB.map((r) => ({
        activity_id: r.activity_id,
        code: r.code,
        title: r.title,
        hours: Number(r.hours),
        prefix: r.prefix,
      })),
    },
  };
}

// สร้าง request — เช็ค eligibility อีกครั้งใน transaction (กัน race condition)
//   + เก็บ rule_snapshot + qualifying snapshot ใน jsonb (audit ภายหลัง)
//   precondition:
//     - ต้อง eligible (ผ่าน 3 ข้อ)
//     - ห้ามมี request ของ user ที่อยู่ในสถานะ REQUESTED|APPROVED ค้าง
//       (ISSUED แล้ว → request ใหม่ได้; REJECTED → request ใหม่ได้)
// คืน:
//   { ok: true, certificate }
//   { ok: false, reason: 'NOT_ELIGIBLE'|'PENDING_EXISTS'|'NO_RULE' }
export async function createRequest(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. lock active rule (กัน super_admin เปลี่ยน rule กลางคัน)
    const { rows: ruleRows } = await client.query(
      `SELECT id, group_a_prefixes, group_b_prefixes,
              group_a_min_activities, group_b_min_activities,
              min_total_hours, effective_from
         FROM cert_requirements
        WHERE effective_to IS NULL
        FOR SHARE`,
    );
    if (ruleRows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'NO_RULE' };
    }
    const rule = ruleRows[0];

    // 2. เช็คมี pending request ค้างไหม
    const { rows: pending } = await client.query(
      `SELECT id FROM certificates
        WHERE user_id = $1
          AND status IN ('REQUESTED','APPROVED')
        LIMIT 1`,
      [userId],
    );
    if (pending.length > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'PENDING_EXISTS' };
    }

    // 3. compute eligibility (query เดียวกับ controller — duplicate เล็กน้อย, เน้น atomicity)
    const allPrefixes = [...rule.group_a_prefixes, ...rule.group_b_prefixes];
    const { rows: qualifying } = await client.query(
      `SELECT a.id, a.code, a.title, a.hours,
              CASE
                WHEN LEFT(a.code, 1) = ANY($2::text[]) THEN 'A'
                WHEN LEFT(a.code, 1) = ANY($3::text[]) THEN 'B'
                ELSE NULL
              END AS grp
         FROM registrations r
         JOIN activities a ON a.id = r.activity_id
        WHERE r.user_id = $1
          AND r.status = 'ATTENDED'
          AND r.evaluation_status = 'PASSED'
          AND a.code IS NOT NULL
          AND LEFT(a.code, 1) = ANY($4::text[])`,
      [userId, rule.group_a_prefixes, rule.group_b_prefixes, allPrefixes],
    );
    const groupA = qualifying.filter((r) => r.grp === 'A');
    const groupB = qualifying.filter((r) => r.grp === 'B');
    const totalHours = qualifying.reduce((s, r) => s + Number(r.hours), 0);

    if (
      groupA.length < rule.group_a_min_activities ||
      groupB.length < rule.group_b_min_activities ||
      totalHours < rule.min_total_hours
    ) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'NOT_ELIGIBLE' };
    }

    // 4. INSERT certificate request
    //    rule_snapshot = full rule + qualifying activity list (เพื่อ audit)
    //    total_hours_at_request = ชั่วโมงรวมที่ใช้ตัดสิน eligibility
    const ruleSnapshot = {
      rule_id: rule.id,
      group_a_prefixes: rule.group_a_prefixes,
      group_b_prefixes: rule.group_b_prefixes,
      group_a_min_activities: rule.group_a_min_activities,
      group_b_min_activities: rule.group_b_min_activities,
      min_total_hours: rule.min_total_hours,
      effective_from: rule.effective_from,
      qualifying_summary: {
        group_a_count: groupA.length,
        group_b_count: groupB.length,
        total_hours: totalHours,
      },
      qualifying_activities: qualifying.map((r) => ({
        activity_id: r.id,
        code: r.code,
        title: r.title,
        hours: Number(r.hours),
        group: r.grp,
      })),
    };

    const { rows: cert } = await client.query(
      `INSERT INTO certificates
         (user_id, status, total_hours_at_request, rule_snapshot)
       VALUES ($1, 'REQUESTED', $2, $3::jsonb)
       RETURNING id, user_id, status, total_hours_at_request,
                 requested_at, created_at`,
      [userId, Math.round(totalHours), JSON.stringify(ruleSnapshot)],
    );

    await client.query('COMMIT');
    return { ok: true, certificate: cert[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// list certificate requests ของ user
export async function listMyRequests(userId) {
  const { rows } = await query(
    `SELECT id,
            status,
            total_hours_at_request,
            rule_snapshot,
            requested_at,
            reviewed_at,
            reviewed_by,
            rejected_reason,
            issued_at,
            document_no
       FROM certificates
      WHERE user_id = $1
      ORDER BY requested_at DESC, id DESC`,
    [userId],
  );
  return rows;
}

// ดึง 1 cert ของ user (เช็ค ownership ฝั่ง caller)
export async function findMyRequest(userId, certId) {
  const { rows } = await query(
    `SELECT id, user_id, status,
            total_hours_at_request, rule_snapshot,
            requested_at, reviewed_at, reviewed_by, rejected_reason,
            issued_at, document_no, pdf_storage_key
       FROM certificates
      WHERE id = $1 AND user_id = $2`,
    [certId, userId],
  );
  return rows[0] ?? null;
}
