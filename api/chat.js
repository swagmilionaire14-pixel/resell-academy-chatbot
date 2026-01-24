// api/chat.js — Resell Academy Chat API (KB v3 + promo/support/FAQ aligned)
// One-shot replacement (copy/paste total).
//
// Key guarantees:
// - Never invent products: only official list.
// - Short, mentor tone (2–6 lines, 1 paragraph by default).
// - Cards are NOT spammed (KB rules).
// - Support/FAQ URLs are correct.
// - Promo codes are explicit (provided by owner) and only surfaced when relevant.
// - Adds actions: link + copy (for coupon UX in widget).

import fs from "fs";
import path from "path";

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
    description: "-10% sur le premier pack",
    appliesTo: "packs_only", // (hors Giga Bundle)
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
 * Knowledge loader (optional file)
 * --------------------------*/
function loadKnowledge() {
  try {
    const filePath = path.join(process.cwd(), "api", "knowledge", "ra_knowledge.txt");
    const text = fs.readFileSync(filePath, "utf8");
    if (!text || !text.trim()) return { text: "", warning: "KB file empty" };
    return { text, warning: null };
  } catch {
    return { text: "", warning: "KB file not found/readable" };
  }
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
 * Price intentionally set to "Voir prix" to avoid hallucinating prices.
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
    wantsSupport: includesAny(t, ["support", "contact", "aide", "probleme", "bug", "erreur", "404"]),
    wantsFaq: includesAny(t, ["faq", "question", "questions", "comment ca marche", "comment ca fonctionne"]),
    wantsPromo: includesAny(t, ["code promo", "promo", "reduction", "reduc", "coupon", "remise", "discount"]),
    asksAvailablePacks: includesAny(t, ["quels packs", "packs disponibles", "tu vends quoi", "quelles offres", "quels produits"]),
    wantsAllCards: includesAny(t, ["montre tout", "toutes les offres", "toutes les cartes", "tous les packs", "tout afficher"]),
    wantsRecommendation: includesAny(t, ["tu recommandes", "recommande", "conseilles", "quel pack choisir", "par ou commencer", "debutant", "debut"]),
    mentions: {
      accessoires: includesAny(t, ["accessoire", "accessoires", "luxe accessoire"]),
      vetements: includesAny(t, ["vetement", "vetements", "vêtement", "vêtements"]),
      chaussures: includesAny(t, ["chaussure", "chaussures", "sneaker", "baskets"]),
      parfums: includesAny(t, ["parfum", "parfums", "fragrance"]),
      tech: includesAny(t, ["tech", "electronique", "électronique", "gadget"]),
      bundle: includesAny(t, ["giga", "bundle", "giga bundle"]),
      blueprint: includesAny(t, ["blueprint", "ebook", "e-book", "livre", "guide"]),
    },
    purchaseSignals: includesAny(t, ["prix", "acheter", "achat", "lien", "ou acheter", "comment je prends", "checkout", "payer", "cart"]),
  };

  return intent;
}

/** ---------------------------
 * Card rules (KB v3)
 * --------------------------*/
function planCards(intent) {
  // A) Recommendation => always Pack Accessoires Luxe + its card
  if (intent.wantsRecommendation) {
    return { mode: "single", keys: ["accessoires"] };
  }

  // B) Pack specific question + purchase intent => send that pack card
  const packKeys = Object.keys(intent.mentions).filter((k) => intent.mentions[k]);
  if (packKeys.length === 1 && intent.purchaseSignals) {
    return { mode: "single", keys: [packKeys[0]] };
  }

  // C) "Quels packs" => list + up to 1–3 cards, unless explicit all
  if (intent.asksAvailablePacks) {
    if (intent.wantsAllCards) {
      return {
        mode: "all",
        keys: ["accessoires", "chaussures", "vetements", "parfums", "tech", "bundle", "blueprint"],
      };
    }
    // Default: 3 best “commercially safe” cards (beginner-friendly + flagship)
    return { mode: "multi", keys: ["accessoires", "bundle", "blueprint"] };
  }

  // Promo path: if user is asking promo AND mentions giga/bundle => include bundle card
  if (intent.wantsPromo && (intent.mentions.bundle || norm("").includes("giga"))) {
    return { mode: "single", keys: ["bundle"] };
  }

  // Otherwise: no cards
  return { mode: "none", keys: [] };
}

/** ---------------------------
 * Actions builder
 * - link actions: open URL
 * - copy actions: copy code to clipboard (widget should implement)
 * --------------------------*/
function buildActions(intent) {
  const actions = [];

  if (intent.wantsSupport) {
    actions.push({ type: "link", label: "Contacter le support", url: URLS.SUPPORT });
  }

  if (intent.wantsFaq) {
    actions.push({ type: "link", label: "Voir la FAQ", url: URLS.FAQ });
  }

  if (intent.wantsPromo) {
    // If user mentions Giga Bundle => prioritize GIGA15
    if (intent.mentions.bundle || includesAny(norm(intent.raw || ""), ["giga", "bundle"])) {
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
      // optional: no forced product link to avoid spam
    }
  }

  return actions;
}

/** ---------------------------
 * Deterministic promo reply (prevents model from inventing other codes)
 * --------------------------*/
function buildPromoReply(intent) {
  if (!intent.wantsPromo) return null;

  // If asking promo and mentions Giga Bundle => show GIGA15 primarily + mention NEW10 secondarily
  if (intent.mentions.bundle) {
    return `Oui : code ${PROMOS.GIGA15.code} (${PROMOS.GIGA15.description}). Si tu prends plutôt un pack individuel, tu as aussi ${PROMOS.NEW10.code} (${PROMOS.NEW10.description}).`;
  }
  // Default: show both succinctly
  return `Oui : ${PROMOS.NEW10.code} (${PROMOS.NEW10.description}) et ${PROMOS.GIGA15.code} (${PROMOS.GIGA15.description}).`;
}

/** ---------------------------
 * Deterministic “available packs” reply (never invent)
 * --------------------------*/
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
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "No message provided" });
    }

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

    const { text: knowledgeText, warning } = loadKnowledge();

    const intent = detectIntent(trimmed);
    intent.raw = trimmed;

    // Cards & actions are deterministic (KB rules)
    const cardPlan = planCards(intent);
    const actions = buildActions(intent);

    const cards =
      cardPlan.mode === "none"
        ? []
        : cardPlan.keys.map((k) => PRODUCT_CARDS[k]).filter(Boolean);

    // Deterministic replies for critical “no-hallucination” zones
    const promoReply = buildPromoReply(intent);
    const packsReply = buildAvailablePacksReply(intent);

    // If promo/packs/support/faq are the main ask, answer deterministically (short).
    // Otherwise, use model with strict system constraints + KB context.
    const deterministicReply =
      promoReply || packsReply
        ? (promoReply || packsReply)
        : null;

    // If user asks only support/faq (and not packs/promo), keep it short and don’t call model.
    const isPureSupport =
      (intent.wantsSupport || intent.wantsFaq) &&
      !intent.asksAvailablePacks &&
      !intent.wantsPromo &&
      !intent.wantsRecommendation &&
      !intent.purchaseSignals;

    if (isPureSupport) {
      const reply = intent.wantsFaq
        ? `Je te mets la FAQ ici : ${URLS.FAQ}. Si ta question n’y est pas, tu peux nous contacter ici : ${URLS.SUPPORT}.`
        : `Tu peux contacter le support ici : ${URLS.SUPPORT}. Si tu veux, la FAQ est là aussi : ${URLS.FAQ}.`;

      await logEvent({
        type: "message",
        origin: origin || null,
        session: req.headers["x-ra-session"] || null,
        user: trimmed,
        hasCards: cards.length > 0,
        mode: "deterministic_support",
      });

      return res.status(200).json({
        reply,
        cards,
        actions,
        kbWarning: warning || null,
      });
    }

    // If deterministic reply exists (promo/packs), return it without model (safer).
    if (deterministicReply) {
      await logEvent({
        type: "message",
        origin: origin || null,
        session: req.headers["x-ra-session"] || null,
        user: trimmed,
        hasCards: cards.length > 0,
        mode: "deterministic_core",
      });

      return res.status(200).json({
        reply: deterministicReply,
        cards,
        actions,
        kbWarning: warning || null,
      });
    }

    // --- Model path (kept, but hard-railed) ---
    const system = `
Tu es le chatbot officiel de Resell Academy.

STYLE
- Réponds en français par défaut.
- Ton: pro mais familial, mentor, rassurant.
- Réponses courtes: 2 à 6 lignes max, 1 seul paragraphe si possible.
- Si la question est complexe: réponds en 2–3 étapes compactes.

RÈGLES “ANTI-INVENTION”
- Produits autorisés UNIQUEMENT: ${OFFICIAL_PRODUCTS.join(", ")}.
- Ne jamais inventer un pack, un bonus, un prix, ou un code promo.
- Si une info n’est pas dans la KB: dis-le clairement et propose la meilleure alternative (page produit / FAQ / support).

FAITS VALIDÉS
- Tout est 100% digital: accès à un Google Sheet + un guide d’usage DHGate + CNFans. Aucun produit physique envoyé.
- DHGate: 7 à 13 jours selon pays.
- CNFans: dépôt + photos qualité + choix/ paiement de l’expédition finale; délais variables, souvent dans une fourchette similaire selon pays/transport.
- Space Resell = le créateur (personne). Resell Academy = business.
- FAQ: ${URLS.FAQ}
- Support: ${URLS.SUPPORT}
- Codes promo disponibles (UNIQUEMENT ceux-ci): ${PROMOS.NEW10.code} (${PROMOS.NEW10.description}) et ${PROMOS.GIGA15.code} (${PROMOS.GIGA15.description}).

KNOWLEDGE BASE (source de vérité)
${knowledgeText || "(KB vide)"}
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
        system,
        messages: [...safeHistory, { role: "user", content: trimmed }],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      await logEvent({
        type: "error",
        provider: "anthropic",
        status: anthropicResp.status,
        message: trimmed,
      });
      return res.status(500).json({
        error: "Anthropic API error",
        status: anthropicResp.status,
        details: errText,
        kbWarning: warning || null,
      });
    }

    const data = await anthropicResp.json();
    let reply = data?.content?.[0]?.text || "Désolé, je n’ai pas compris. Peux-tu reformuler ?";

    // Post-guard: if model mentions a non-official product name, neutralize (anti-hallucination).
    // (Simple heuristic: if it contains "Pack" + unknown term, advise official list.)
    const rNorm = norm(reply);
    const mentionsPack = rNorm.includes("pack");
    if (mentionsPack) {
      const allowedTokens = OFFICIAL_PRODUCTS.map((p) => norm(p));
      // If it says "pack" but none of the official packs are present, it may have invented.
      const hasOfficial = allowedTokens.some((tok) => rNorm.includes(tok));
      if (!hasOfficial && !intent.asksAvailablePacks) {
        reply =
          `Je préfère éviter de te donner une info au hasard. Les seuls produits officiels sont : ` +
          `Pack Parfums, Pack Tech, Pack Accessoires Luxe, Pack Chaussures, Pack Vêtements, ` +
          `Giga Bundle et Resell Blueprint. Tu veux que je te recommande le meilleur pour commencer ?`;
      }
    }

    await logEvent({
      type: "message",
      origin: origin || null,
      session: req.headers["x-ra-session"] || null,
      user: trimmed,
      hasCards: cards.length > 0,
      mode: "model",
    });

    return res.status(200).json({
      reply,
      cards,
      actions,
      kbWarning: warning || null,
    });
  } catch (error) {
    await logEvent({ type: "crash", details: String(error) });
    return res.status(500).json({ error: "Server error", details: String(error) });
  }
}
