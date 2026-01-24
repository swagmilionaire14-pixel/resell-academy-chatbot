// api/track.js — Resell Academy Chat Analytics Ingestion (Supabase) — PayHip-proof
// Copy/paste total

const ALLOWED_EVENTS = new Set([
  "page_view",
  "page_unload",
  "chat_open",
  "chat_close",
  "fullscreen_on",
  "fullscreen_off",
  "quick_click",
  "ui_click",
  "msg_user_send",
  "msg_bot_reply",
  "cards_shown",
  "card_click_view",
  "card_click_add",
  "actions_shown",
  "action_click",
  "coupon_copy_success",
  "coupon_copy_fail",
  "error_client",
]);

// Basic in-memory rate limit per serverless instance
const RL_WINDOW_MS = 60_000;
const RL_MAX_EVENTS = 180;
const buckets = new Map();

function setCors(req, res) {
  const origin = req.headers.origin || "*";
  // PayHip can use different origins (custom domain, payhip pages, previews).
  // We reflect the origin to avoid CORS issues.
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getClientKey(req) {
  const ip =
    (req.headers["x-forwarded-for"] || "")
      .toString()
      .split(",")[0]
      .trim() || req.socket?.remoteAddress || "unknown";
  const ua = (req.headers["user-agent"] || "unknown").toString().slice(0, 120);
  return `${ip}|${ua}`;
}

function rateLimit(req) {
  const key = getClientKey(req);
  const now = Date.now();

  const item = buckets.get(key) || { ts: now, count: 0 };
  if (now - item.ts > RL_WINDOW_MS) {
    item.ts = now;
    item.count = 0;
  }
  item.count += 1;
  buckets.set(key, item);

  const remaining = Math.max(0, RL_MAX_EVENTS - item.count);
  const ok = item.count <= RL_MAX_EVENTS;
  const retryAfterSec = ok ? 0 : Math.ceil((RL_WINDOW_MS - (now - item.ts)) / 1000);

  return { ok, remaining, retryAfterSec };
}

function safeStr(v, max = 500) {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, max);
}

function safeJson(v) {
  if (!v || typeof v !== "object") return {};
  try {
    const s = JSON.stringify(v);
    if (s.length > 7000) return { _trimmed: true };
    return v;
  } catch {
    return {};
  }
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const session_id = safeStr(raw.session_id, 180);
  const event_name = safeStr(raw.event_name, 80);

  if (!session_id || !event_name) return null;
  if (!ALLOWED_EVENTS.has(event_name)) return null;

  return {
    session_id,
    event_name,
    page_url: safeStr(raw.page_url, 800),
    referrer: safeStr(raw.referrer, 800),
    user_agent: safeStr(raw.user_agent, 400),
    tz: safeStr(raw.tz, 120),
    lang: safeStr(raw.lang, 40),
    meta: safeJson(raw.meta),
  };
}

async function insertEventsToSupabase(events) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/chat_events`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(events),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Supabase insert failed (${resp.status}): ${t.slice(0, 400)}`);
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rl = rateLimit(req);
  res.setHeader("X-RateLimit-Limit", String(RL_MAX_EVENTS));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfterSec));
    return res.status(429).json({ error: "Too many events", retryAfterSec: rl.retryAfterSec });
  }

  try {
    const body = req.body || {};
    const rawEvents = Array.isArray(body.batch) ? body.batch : [body];

    const events = rawEvents
      .slice(0, 25)
      .map(normalizeEvent)
      .filter(Boolean);

    if (!events.length) {
      return res.status(200).json({ ok: true, inserted: 0, rejected: rawEvents.length });
    }

    await insertEventsToSupabase(events);
    return res.status(200).json({ ok: true, inserted: events.length, rejected: rawEvents.length - events.length });
  } catch (e) {
    return res.status(500).json({ error: "Track server error", details: String(e).slice(0, 400) });
  }
}
