// api/admin/conversations.js — Chat Inbox API (Supabase)
// Copy/paste total

function cors(req, res){
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function mustToken(req){
  const token = (req.query?.token || "").toString();
  const expected = (process.env.ADMIN_STATS_TOKEN || "").toString();
  if(!expected) return { ok:false, code:500, error:"Misconfigured", details:"Missing env: ADMIN_STATS_TOKEN" };
  if(token !== expected) return { ok:false, code:401, error:"Unauthorized" };
  return { ok:true };
}

async function supabaseFetch(path){
  const SUPABASE_URL = (process.env.SUPABASE_URL || "").toString().trim();
  const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").toString().trim();
  if(!SUPABASE_URL || !KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  if(!SUPABASE_URL.startsWith("http")) throw new Error("SUPABASE_URL must be like https://xxxx.supabase.co");
  const url = SUPABASE_URL.replace(/\/$/, "") + path;
  const r = await fetch(url, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
  });
  if(!r.ok){
    const t = await r.text().catch(()=> "");
    throw new Error(`Supabase error ${r.status}: ${t.slice(0,300)}`);
  }
  return r.json();
}

function safeStr(v, max=2000){
  if(v === null || v === undefined) return "";
  return String(v).slice(0,max);
}

export default async function handler(req, res){
  cors(req, res);
  if(req.method === "OPTIONS") return res.status(204).end();
  if(req.method !== "GET") return res.status(405).json({ error:"Method not allowed" });

  const tok = mustToken(req);
  if(!tok.ok) return res.status(tok.code).json({ error: tok.error, details: tok.details });

  const sessionId = (req.query?.session_id || "").toString().trim();
  const limit = Math.min(500, Math.max(50, Number(req.query?.limit || 250)));

  try{
    if(!sessionId){
      // List sessions from last N events (simple + effective)
      const rows = await supabaseFetch(
        `/rest/v1/chat_events?select=created_at,session_id,event_name,meta` +
        `&event_name=in.(msg_user_send,msg_bot_reply)` +
        `&order=created_at.desc&limit=${limit}`
      );

      const map = new Map();
      for(const r of rows){
        const sid = r.session_id;
        if(!sid) continue;
        const cur = map.get(sid) || { session_id: sid, last_seen: r.created_at, messages: 0 };
        cur.last_seen = cur.last_seen > r.created_at ? cur.last_seen : r.created_at;
        cur.messages += 1;
        map.set(sid, cur);
      }

      const sessions = Array.from(map.values())
        .sort((a,b) => (b.last_seen || "").localeCompare(a.last_seen || ""))
        .slice(0, 50)
        .map(s => ({
          session_id: s.session_id,
          session_short: s.session_id.slice(0, 14) + "…",
          last_seen: s.last_seen,
          messages: s.messages
        }));

      return res.status(200).json({ sessions });
    }

    // Conversation replay
    const rows = await supabaseFetch(
      `/rest/v1/chat_events?select=created_at,session_id,event_name,meta,page_url,referrer` +
      `&session_id=eq.${encodeURIComponent(sessionId)}` +
      `&event_name=in.(chat_open,msg_user_send,msg_bot_reply,cards_shown,action_click,card_click_view,card_click_add,coupon_copy_success,error_client)` +
      `&order=created_at.asc&limit=1000`
    );

    const messages = [];
    for(const r of rows){
      const name = r.event_name;
      const t = r.created_at;

      if(name === "msg_user_send"){
        messages.push({ ts:t, role:"user", type:"text", text: safeStr(r?.meta?.text || "") });
      } else if(name === "msg_bot_reply"){
        messages.push({ ts:t, role:"bot", type:"text", text: safeStr(r?.meta?.text || "") });
      } else if(name === "cards_shown"){
        const items = Array.isArray(r?.meta?.items) ? r.meta.items : [];
        messages.push({ ts:t, role:"bot", type:"cards", items });
      } else if(name === "action_click"){
        messages.push({ ts:t, role:"system", type:"action_click", meta: r.meta || {} });
      } else if(name === "card_click_view" || name === "card_click_add"){
        messages.push({ ts:t, role:"system", type:name, meta: r.meta || {} });
      } else if(name === "coupon_copy_success"){
        messages.push({ ts:t, role:"system", type:"coupon_copy", meta: r.meta || {} });
      } else if(name === "error_client"){
        messages.push({ ts:t, role:"system", type:"error", meta: r.meta || {} });
      }
    }

    return res.status(200).json({
      session_id: sessionId,
      messages
    });

  }catch(e){
    return res.status(500).json({ error:"Server error", details: String(e).slice(0,600) });
  }
}
