// api/chat.js — Resell Academy Chat API (KB v3 aligned + KB loader fix + debug)
// One-shot replacement (copy/paste total).
//
// Fixes:
// - KB loader now searches multiple possible file paths/names (prevents "KB not taken into account").
// - Adds kbStatus/kbSource/kbDigest to API response for debugging deployments.
// - Tightens anti-hallucination when KB missing.
// - Supports promo/support/FAQ + actions[] (link/copy) + card anti-spam rules.

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ALLOWED_ORIGINS = new Set([
  "https://resell-academy.com",
  "https://www.resell-academy.com",
  // Ajoute ici tes domaines PayHip si nécessaire
]);

const URLS = {
  SUPPORT: "https://resell-academy.com/contact",
  FAQ: "https://resell-academy.com/faq",
  PRODUCTS: {
    accessoires: "https://resell-academy.com/b/accessoires",
    vetements: "https://resell-academy.com/b/vetements",
    chaussures: "https://resell-academy.com/b/chaussures",
    parfums: "https://resell-academy.com/b/parfums",
    tech: "https://resell-academy.com/b/tech",
    bundle: "https://resell-academy.com/b/giga-bundle",
    blueprint: "https://resell-academy.com/b/OmtC5",
  },
};

const PROMOS = {
  NEW10: {
    code: "NEW10",
    label: "NEW10",
    description: "-10% de réduction sur le premier pack",
    appliesTo: "packs_only",
  },
  GIGA15: {
    code: "GIGA15",
    label: "GIGA15",
    description: "-15% sur le Giga Bundle uniquement",
    appliesTo: "giga_bundle_only",
  },
};

/** ---------------------------
 * CORS
 * --------------------------*/
function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://resell-academy.com";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-RA-Session");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/** ---------------------------
 * Basic in-memory rate limit (per instance)
 * --------------------------*/
const RL_WINDOW_MS = 60_000;
const RL_MAX_REQ = 30;
const buckets = new Map();

function getClientKey(req) {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const ua = req.headers["user-agent"] || "unknown";
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

  const remaining = Math.max(0, RL_MAX_REQ - item.count);
  const ok = item.count <= RL_MAX_REQ;
  const retryAfterSec = ok ? 0 : Math.ceil((RL_WINDOW_MS - (now - item.ts)) / 1000);

  return { ok, remaining, retryAfterSec };
}

/** ---------------------------
 * Knowledge loader (multi-path + digest)
 * - This is the #1 cause of "I updated KB but bot ignores it"
 * --------------------------*/
function sha1(text) {
  return crypto.createHash("sha1").update(text || "", "utf8").digest("hex");
}

function readIfExists(absPath) {
  try {
    if (!absPath) return null;
    if (!fs.existsSync(absPath)) return null;
    const text = fs.readFileSync(absPath, "utf8");
    if (!text || !text.trim()) return { text: "", source: absPath, empty: true };
    return { text, source: absPath, empty: false };
  } catch {
    return null;
  }
}

function loadKnowledge() {
  // Optional: allow override via env var
  // Example: KB_PATH="api/knowledge/knowledge.txt"
  const envPath = process.env.KB_PATH
    ? path.isAbsolute(process.env.KB_PATH)
      ? process.env.KB_PATH
      : path.join(process.cwd(), process.env.KB_PATH)
    : null;

  const candidates = [
    envPath,

    // Previous path used in earlier code
    path.join(process.cwd(), "api", "knowledge", "ra_knowledge.txt"),

    // Common names people use
    path.join(process.cwd(), "api", "knowledge", "knowledge.txt"),
    path.join(process.cwd(), "knowledge.txt"),
    path.join(process.cwd(), "knowlegde.txt"), // common typo
    path.join(process.cwd(), "KNOWLEGDE CHATBOT.txt"), // if you kept this filename

    // If you placed it next to api file
    path.join(process.cwd(), "api", "knowledge.txt"),
  ].filter(Boolean);

  for (const p of candidates) {
    const hit = readIfExists(p);
    if (hit) {
      const digest = sha1(hit.text || "");
      return {
        text: hit.text || "",
        kbStatus: hit.empty ? "empty" : "ok",
        kbSource: hit.source,
        kbDigest: digest,
      };
    }
  }

  return {
    text: "",
    kbStatus: "missing",
    kbSource: null,
    kbDigest: sha1(""),
  };
}

/** ---------------------------
 * Official products (KB v3 — never invent)
 * --------------------------*/
const OFFICIAL_PRODUCTS = [
  "Pack Parfums",
  "Pack Tech",
  "Pack Accessoires Luxe",
  "Pack Chaussures",
  "Pack Vêtements",
  "Giga Bundle",
  "Resell Blueprint",
];

/** ---------------------------
 * Product cards (deterministic)
 * Price intentionally "Voir prix" to avoid inventing prices.
 * --------------------------*/
const PRODUCT_CARDS = {
  accessoires: {
    key: "accessoires",
    title: "Pack Accessoires Luxe",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_ACCESSOIRES.jpg?v=1769183567",
    url: URLS.PRODUCTS.accessoires,
  },
  vetements: {
    key: "vetements",
    title: "Pack Vêtements",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_VETEMENTS.jpg?v=1769183578",
    url: URLS.PRODUCTS.vetements,
  },
  chaussures: {
    key: "chaussures",
    title: "Pack Chaussures",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_CHAUSSURES.jpg?v=1769183578",
    url: URLS.PRODUCTS.chaussures,
  },
  parfums: {
    key: "parfums",
    title: "Pack Parfums",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/pack_parfums.jpg?v=1769183588",
    url: URLS.PRODUCTS.parfums,
  },
  tech: {
    key: "tech",
    title: "Pack Tech",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/Copy_of_Copy_of_COVER_PACK_CHAUSSURES.jpg?v=1769183564",
    url: URLS.PRODUCTS.tech,
  },
  bundle: {
    key: "bundle",
    title: "Giga Bundle",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_GIGA_BUNDLE_V2_GIF.png?v=1769183604",
    url: URLS.PRODUCTS.bundle,
  },
  blueprint: {
    key: "blueprint",
    title: "Resell Blueprint",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_SECONDAIRE_RESELL_BLUEPRINT.jpg?v=1769183606",
    url: URLS.PRODUCTS.blueprint,
  },
};

/** ---------------------------
 * Intent helpers
 * --------------------------*/
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function includesAny(t, arr) {
  return arr.some((k) => t.includes(k));
}

function detectIntent(userTextRaw) {
  const t = norm(userTextRaw);

  const intent = {
    raw: userTextRaw,
    wantsSupport: includesAny(t, ["support", "contact", "aide", "probleme", "bug", "erreur", "404"]),
    wantsFaq: includesAny(t, ["faq", "questions", "question", "comment ca marche", "comment ca fonctionne"]),
    wantsPromo: includesAny(t, ["code promo", "promo", "reduction", "reduc", "coupon", "remise", "discount"]),
    asksAvailablePacks: includesAny(t, ["quels packs", "packs disponibles", "tu vends quoi", "quelles offres", "quels produits"]),
    wantsAllCards: includesAny(t, ["montre tout", "toutes les offres", "toutes les cartes", "tous les packs", "tout afficher"]),
    wantsRecommendation: includesAny(t, ["tu recommandes", "recommande", "conseilles", "quel pack choisir", "par ou commencer", "debutant", "debut"]),
    mentions: {
      accessoires: includesAny(t, ["accessoire", "accessoires"]),
      vetements: includesAny(t, ["vetement", "vetements", "vêtement", "vêtements"]),
      chaussures: includesAny(t, ["chaussure", "chaussures", "sneaker", "baskets"]),
      parfums: includesAny(t, ["parfum", "parfums", "fragrance"]),
      tech: includesAny(t, ["tech", "electronique", "électronique", "gadget"]),
      bundle: includesAny(t, ["giga", "bundle", "giga bundle"]),
      blueprint: includesAny(t, ["blueprint", "ebook", "e-book", "livre", "guide"]),
    },
    purchaseSignals: includesAny(t, ["prix", "acheter", "achat", "lien", "ou acheter", "comment je prends", "checkout", "payer", "panier", "cart"]),
  };

  return intent;
}

/** ---------------------------
 * Card rules (KB v3)
 * --------------------------*/
function planCards(intent) {
  if (intent.wantsRecommendation) return { keys: ["accessoires"] };

  const packKeys = Object.keys(intent.mentions).filter((k) => intent.mentions[k]);
  if (packKeys.length === 1 && intent.purchaseSignals) return { keys: [packKeys[0]] };

  if (intent.asksAvailablePacks) {
    if (intent.wantsAllCards) {
      return { keys: ["accessoires", "chaussures", "vetements", "parfums", "tech", "bundle", "blueprint"] };
    }
    return { keys: ["accessoires", "bundle", "blueprint"] }; // max 1–3
  }

  // Promo + giga mention => bundle card
  if (intent.wantsPromo && intent.mentions.bundle) return { keys: ["bundle"] };

  return { keys: [] };
}

/** ---------------------------
 * Actions builder (link + copy)
 * --------------------------*/
function buildActions(intent) {
  const actions = [];

  if (intent.wantsSupport) actions.push({ type: "link", label: "Contacter le support", url: URLS.SUPPORT });
  if (intent.wantsFaq) actions.push({ type: "link", label: "Voir la FAQ", url: URLS.FAQ });

  if (intent.wantsPromo) {
    if (intent.mentions.bundle) {
      actions.push({
        type: "copy",
        label: `Copier ${PROMOS.GIGA15.label}`,
        value: PROMOS.GIGA15.code,
        description: PROMOS.GIGA15.description,
      });
      actions.push({ type: "link", label: "Ouvrir le Giga Bundle", url: URLS.PRODUCTS.bundle });
    } else {
      actions.push({
        type: "copy",
        label: `Copier ${PROMOS.NEW10.label}`,
        value: PROMOS.NEW10.code,
        description: PROMOS.NEW10.description,
      });
    }
  }

  return actions;
}

/** ---------------------------
 * Deterministic replies (anti-hallucination zones)
 * --------------------------*/
function buildPromoReply(intent) {
  if (!intent.wantsPromo) return null;
  if (intent.mentions.bundle) {
    return `Oui : code ${PROMOS.GIGA15.code} (${PROMOS.GIGA15.description}). Pour un pack individuel, tu as aussi ${PROMOS.NEW10.code} (${PROMOS.NEW10.description}).`;
  }
  return `Oui : ${PROMOS.NEW10.code} (${PROMOS.NEW10.description}) et ${PROMOS.GIGA15.code} (${PROMOS.GIGA15.description}).`;
}

function buildAvailablePacksReply(intent) {
  if (!intent.asksAvailablePacks) return null;
  return `Les seuls produits disponibles sont : Pack Parfums, Pack Tech, Pack Accessoires Luxe, Pack Chaussures, Pack Vêtements, le Giga Bundle (tous les packs + bonus) et le Resell Blueprint.`;
}

/** ---------------------------
 * Logging (optional)
 * --------------------------*/
async function logEvent(event) {
  try {
    console.log("[RA_CHAT_EVENT]", JSON.stringify(event));
    const url = process.env.RA_LOG_WEBHOOK;
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // no-op
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const origin = req.headers.origin || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  const rl = rateLimit(req);
  res.setHeader("X-RateLimit-Limit", String(RL_MAX_REQ));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfterSec));
    return res.status(429).json({ error: "Too many requests", retryAfterSec: rl.retryAfterSec });
  }

  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== "string") return res.status(400).json({ error: "No message provided" });

    const trimmed = message.trim();
    if (!trimmed) return res.status(400).json({ error: "Empty message" });
    if (trimmed.length > 1200) return res.status(400).json({ error: "Message too long" });

    const safeHistory =
      Array.isArray(history) && history.length
        ? history
            .slice(-8)
            .filter(
              (m) =>
                m &&
                (m.role === "user" || m.role === "assistant") &&
                typeof m.content === "string" &&
                m.content.trim().length > 0 &&
                m.content.length <= 1200
            )
        : [];

    const kb = loadKnowledge();
    const intent = detectIntent(trimmed);

    const cardsPlan = planCards(intent);
    const cards = (cardsPlan.keys || []).map((k) => PRODUCT_CARDS[k]).filter(Boolean);
    const actions = buildActions(intent);

    // Deterministic answers for sensitive areas
    const promoReply = buildPromoReply(intent);
    const packsReply = buildAvailablePacksReply(intent);

    const isPureSupport =
      (intent.wantsSupport || intent.wantsFaq) &&
      !intent.asksAvailablePacks &&
      !intent.wantsPromo &&
      !intent.wantsRecommendation &&
      !intent.purchaseSignals;

    if (isPureSupport) {
      const reply = intent.wantsFaq
        ? `Je te mets la FAQ ici : ${URLS.FAQ}. Si ta question n’y est pas, tu peux nous contacter ici : ${URLS.SUPPORT}.`
        : `Tu peux contacter le support ici : ${URLS.SUPPORT}. La FAQ est là : ${URLS.FAQ}.`;

      await logEvent({ type: "message", mode: "det_support", kbStatus: kb.kbStatus, kbSource: kb.kbSource });

      return res.status(200).json({
        reply,
        cards,
        actions,
        kbStatus: kb.kbStatus,
        kbSource: kb.kbSource,
        kbDigest: kb.kbDigest,
      });
    }

    if (promoReply || packsReply) {
      const reply = promoReply || packsReply;
      await logEvent({ type: "message", mode: "det_core", kbStatus: kb.kbStatus, kbSource: kb.kbSource });

      return res.status(200).json({
        reply,
        cards,
        actions,
        kbStatus: kb.kbStatus,
        kbSource: kb.kbSource,
        kbDigest: kb.kbDigest,
      });
    }

    // If KB is missing/empty, do NOT allow "precise facts". Return safe response.
    if (kb.kbStatus !== "ok") {
      const reply =
        `Je peux t’aider, mais je ne peux pas confirmer des infos précises car la base de connaissance n’est pas chargée côté serveur. ` +
        `Le plus sûr : consulte la FAQ (${URLS.FAQ}) ou contacte le support (${URLS.SUPPORT}).`;

      await logEvent({ type: "message", mode: "kb_missing_guard", kbStatus: kb.kbStatus, kbSource: kb.kbSource });

      return res.status(200).json({
        reply,
        cards,
        actions,
        kbStatus: kb.kbStatus,
        kbSource: kb.kbSource,
        kbDigest: kb.kbDigest,
      });
    }

    // --- Model path (hard-railed) ---
    const system = `
Tu es le chatbot officiel de Resell Academy.

STYLE
- Réponds en français.
- Ton: pro mais familial, mentor, rassurant.
- Réponse courte: 2 à 6 lignes, 1 paragraphe si possible.

ANTI-INVENTION (STRICT)
- Produits autorisés UNIQUEMENT: ${OFFICIAL_PRODUCTS.join(", ")}.
- Ne jamais inventer un pack, un bonus, un prix, ou un code promo.
- Si l’info n’est pas clairement dans la KB, dis: "Je ne vois pas cette info dans la base de connaissance" et renvoie vers FAQ/support.

FAITS VALIDÉS
- Tout est 100% digital: accès à un Google Sheet + un guide d’usage DHGate + CNFans.
- DHGate: 7 à 13 jours selon pays.
- CNFans: dépôt + photos qualité + choix/paiement de l’expédition finale; délais variables.
- Space Resell = créateur (personne). Resell Academy = business.
- FAQ: ${URLS.FAQ}
- Support: ${URLS.SUPPORT}
- Codes promo (uniquement ceux-ci): ${PROMOS.NEW10.code} (${PROMOS.NEW10.description}) et ${PROMOS.GIGA15.code} (${PROMOS.GIGA15.description}).

KNOWLEDGE BASE (source de vérité)
${kb.text}
`.trim();

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 420,
        temperature: 0.2,
        system,
        messages: [...safeHistory, { role: "user", content: trimmed }],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      await logEvent({ type: "error", provider: "anthropic", status: anthropicResp.status });

      return res.status(500).json({
        error: "Anthropic API error",
        status: anthropicResp.status,
        details: errText,
        kbStatus: kb.kbStatus,
        kbSource: kb.kbSource,
        kbDigest: kb.kbDigest,
      });
    }

    const data = await anthropicResp.json();
    let reply = data?.content?.[0]?.text || "Désolé, je n’ai pas compris. Peux-tu reformuler ?";

    // Post-guard: if answer suggests non-official products, neutralize
    const r = norm(reply);
    if (r.includes("pack")) {
      const allowed = OFFICIAL_PRODUCTS.map((p) => norm(p));
      const hasOfficial = allowed.some((tok) => r.includes(tok));
      if (!hasOfficial && !intent.asksAvailablePacks) {
        reply =
          `Je préfère éviter de te donner une info au hasard. Les seuls produits officiels sont : ` +
          `Pack Parfums, Pack Tech, Pack Accessoires Luxe, Pack Chaussures, Pack Vêtements, ` +
          `Giga Bundle et Resell Blueprint.`;
      }
    }

    await logEvent({ type: "message", mode: "model", kbStatus: kb.kbStatus, kbSource: kb.kbSource });

    return res.status(200).json({
      reply,
      cards,
      actions,
      kbStatus: kb.kbStatus,
      kbSource: kb.kbSource,
      kbDigest: kb.kbDigest,
    });
  } catch (error) {
    await logEvent({ type: "crash", details: String(error) });
    return res.status(500).json({ error: "Server error", details: String(error) });
  }
}
