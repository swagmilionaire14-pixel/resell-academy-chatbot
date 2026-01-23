import fs from "fs";
import path from "path";

let cachedKnowledge = null;
let cachedKnowledgeMtimeMs = 0;

// Rate limit très simple en mémoire (OK pour débuter)
const RATE = {
  windowMs: 60_000, // 1 minute
  max: 20,          // 20 requêtes / minute / IP
};
const ipHits = new Map(); // ip -> { count, resetAt }

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function rateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const hit = ipHits.get(ip);

  if (!hit || now > hit.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE.windowMs });
    return { ok: true };
  }

  hit.count += 1;
  if (hit.count > RATE.max) {
    return { ok: false, retryAfterSec: Math.ceil((hit.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function isAllowedOrigin(origin) {
  if (!origin) return false;

  // Mets ici TES domaines exacts (avec https)
  const ALLOWED = new Set([
    "https://resell-academy.com",
    "https://www.resell-academy.com",

    // Payhip (parfois le checkout / assets passent par là)
    "https://payhip.com",
    "https://www.payhip.com",
  ]);

  // Autoriser aussi les sous-domaines *.payhip.com si besoin
  try {
    const u = new URL(origin);
    if (ALLOWED.has(origin)) return true;
    if (u.hostname.endsWith(".payhip.com")) return true;
  } catch (_) {
    return false;
  }

  return false;
}

function setCors(req, res) {
  const origin = req.headers.origin;

  // Si origin est autorisé, on le renvoie (sinon on ne met rien)
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "false");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function loadKnowledge() {
  // On essaye plusieurs chemins possibles pour être robuste
  const candidates = [
    path.join(process.cwd(), "api", "knowledge", "ra_knowledge.txt"),     // ton cas (capture GitHub)
    path.join(process.cwd(), "knowledge", "ra_knowledge.txt"),
    path.join(process.cwd(), "public", "ra_knowledge.txt"),
  ];

  let filePath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      filePath = p;
      break;
    }
  }

  if (!filePath) {
    return {
      text: "",
      warning:
        "Knowledge file not found. Expected api/knowledge/ra_knowledge.txt (or /knowledge or /public).",
    };
  }

  const stat = fs.statSync(filePath);

  // Cache : si le fichier n’a pas changé, on réutilise
  if (cachedKnowledge && stat.mtimeMs === cachedKnowledgeMtimeMs) {
    return { text: cachedKnowledge, warning: null };
  }

  const text = fs.readFileSync(filePath, "utf8");
  cachedKnowledge = text;
  cachedKnowledgeMtimeMs = stat.mtimeMs;

  return { text, warning: null };
}

export default async function handler(req, res) {
  // 1) CORS
  setCors(req, res);

  // 2) Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // 3) POST only
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 4) Bloquer les appels hors site (Origin/Referer)
  // Payhip / navigateur met souvent Origin. Sinon on tombe sur Referer.
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  const originOk = origin ? isAllowedOrigin(origin) : false;
  const refererOk = (() => {
    if (!referer) return false;
    try {
      const u = new URL(referer);
      const refOrigin = `${u.protocol}//${u.host}`;
      return isAllowedOrigin(refOrigin);
    } catch (_) {
      return false;
    }
  })();

  if (!originOk && !refererOk) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // 5) Rate limit
  const rl = rateLimit(req);
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfterSec));
    return res.status(429).json({
      error: "Too many requests",
      retryAfterSec: rl.retryAfterSec,
    });
  }

  try {
    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "No message provided" });
    }

    // Garde-fous
    const trimmed = message.trim();
    if (trimmed.length < 1) {
      return res.status(400).json({ error: "Empty message" });
    }
    if (trimmed.length > 1200) {
      return res.status(400).json({ error: "Message too long" });
    }

    const { text: knowledgeText, warning } = loadKnowledge();

    // SYSTEM = ton ton + tes règles + la KB
    const system = `
Tu es le chatbot officiel de Resell Academy.
Ton style: pro mais familial, chaleureux, clair, orienté aide.
Si tu n'es pas sûr à 100% d'une info, dis-le et propose de contacter le support.

Règles support:
- Tous les produits sont 100% digitaux, accès immédiat après paiement.
- Si question non couverte: proposer support@resell-academy.com.
- Politique remboursement: si téléchargement effectué => pas de remboursement (sauf cas achat double / fraude / etc. selon KB).

IMPORTANT:
- Réponds en français par défaut.
- Réponses courtes, actionnables, pas de blabla.

KNOWLEDGE BASE (source de vérité):
${knowledgeText || "(KB vide pour le moment)"}
`.trim();

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        system,
        messages: [{ role: "user", content: trimmed }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({
        error: "Anthropic API error",
        status: response.status,
        details: errText,
        kbWarning: warning || null,
      });
    }

    const data = await response.json();
    const reply = data?.content?.[0]?.text || "Désolé, je n’ai pas compris. Peux-tu reformuler ?";

    return res.status(200).json({
      reply,
      kbWarning: warning || null,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: String(error),
    });
  }
}
