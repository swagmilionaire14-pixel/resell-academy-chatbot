// api/admin/stats.js — Resell Academy Chat Analytics Dashboard (Supabase) — debug-friendly
const ALLOWED_ORIGINS = new Set([
  "https://resell-academy.com",
  "https://www.resell-academy.com",
]);

function setCors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const idx = Math.ceil((p / 100) * a.length) - 1;
  return a[Math.max(0, Math.min(a.length - 1, idx))];
}

async function fetchEventsSince(isoTs) {
  const SUPABASE_URL = (process.env.SUPABASE_URL || "").toString().trim();
  const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").toString().trim();

  if (!SUPABASE_URL) throw new Error("Missing env: SUPABASE_URL");
  if (!SERVICE_ROLE) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL.startsWith("http")) {
    throw new Error("SUPABASE_URL must be a URL like https://xxxx.supabase.co (you likely pasted a key)");
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const url =
    `${base}/rest/v1/chat_events` +
    `?select=created_at,session_id,event_name,meta` +
    `&created_at=gte.${encodeURIComponent(isoTs)}` +
    `&order=created_at.desc`;

  const pageSize = 1000;
  let from = 0;
  let all = [];

  while (true) {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Range: `${from}-${from + pageSize - 1}`,
      },
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Supabase fetch failed (${resp.status}): ${t.slice(0, 400)}`);
    }

    const batch = await resp.json();
    all = all.concat(batch);

    if (!Array.isArray(batch) || batch.length < pageSize) break;
    from += pageSize;
    if (all.length >= 20000) break;
  }

  return all;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = (req.query?.token || "").toString();
  const expected = (process.env.ADMIN_STATS_TOKEN || "").toString();
  if (!expected) return res.status(500).json({ error: "Misconfigured", details: "Missing env: ADMIN_STATS_TOKEN" });
  if (token !== expected) return res.status(401).json({ error: "Unauthorized" });

  const range = (req.query?.range || "24h").toString();
  const now = Date.now();
  const ms =
    range === "7d" ? 7 * 24 * 60 * 60 * 1000 :
    range === "30d" ? 30 * 24 * 60 * 60 * 1000 :
    24 * 60 * 60 * 1000;

  const sinceIso = new Date(now - ms).toISOString();
  const since5mIso = new Date(now - 5 * 60 * 1000).toISOString();

  try {
    const [events24, events5m] = await Promise.all([
      fetchEventsSince(sinceIso),
      fetchEventsSince(since5mIso),
    ]);

    const sessions = new Set();
    let messages = 0;
    let errors = 0;
    let cards_shown = 0;
    let card_click_view = 0;
    let card_click_add = 0;
    let coupon_copy = 0;
    const latencies = [];
    const actionCounts = new Map();

    for (const e of events24) {
      if (e.session_id) sessions.add(e.session_id);

      if (e.event_name === "msg_user_send" || e.event_name === "msg_bot_reply") messages += 1;
      if (e.event_name === "error_client") errors += 1;

      if (e.event_name === "msg_bot_reply") {
        const ms = Number(e?.meta?.latency_ms);
        if (Number.isFinite(ms) && ms >= 0 && ms <= 120000) latencies.push(ms);
        const ok = e?.meta?.ok;
        const status = Number(e?.meta?.status);
        if (ok === false || (Number.isFinite(status) && status >= 400)) errors += 1;
      }

      if (e.event_name === "cards_shown") cards_shown += 1;
      if (e.event_name === "card_click_view") card_click_view += 1;
      if (e.event_name === "card_click_add") card_click_add += 1;
      if (e.event_name === "coupon_copy_success") coupon_copy += 1;

      if (e.event_name === "action_click") {
        const type = (e?.meta?.type || "unknown").toString();
        const label = (e?.meta?.label || "unknown").toString();
        const key = `${type}:${label}`;
        actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
      }
    }

    const active_sessions_5m = new Set(events5m.map(x => x.session_id).filter(Boolean)).size;
    const latency_p95_ms = percentile(latencies, 95);
    const cards_ctr_pct = cards_shown > 0 ? Math.round(((card_click_view + card_click_add) / cards_shown) * 1000) / 10 : 0;

    const top_actions = Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return res.status(200).json({
      range,
      since: sinceIso,
      sessions: sessions.size,
      active_sessions_5m,
      messages,
      errors,
      latency_p95_ms,
      cards_shown,
      card_click_view,
      card_click_add,
      cards_ctr_pct,
      coupon_copy,
      top_actions,
      events_total: events24.length,
    });
  } catch (e) {
    return res.status(500).json({ error: "Stats server error", details: String(e).slice(0, 600) });
  }
}
