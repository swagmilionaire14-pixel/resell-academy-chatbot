// api/chat.js
import fs from "fs";
import path from "path";

const ALLOWED_ORIGINS = new Set([
  "https://resell-academy.com",
  "https://www.resell-academy.com",
  // Ajoute ici tes domaines PayHip si tu utilises un sous-domaine PayHip custom
]);

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
  // Best-effort: IP (varies on Vercel) + UA
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
 * Knowledge loader
 * --------------------------*/
function loadKnowledge() {
  try {
    const filePath = path.join(process.cwd(), "api", "knowledge", "ra_knowledge.txt");
    const text = fs.readFileSync(filePath, "utf8");
    if (!text || !text.trim()) return { text: "", warning: "KB file empty" };
    return { text, warning: null };
  } catch (e) {
    return { text: "", warning: "KB file not found/readable" };
  }
}

/** ---------------------------
 * Cards (MVP deterministic)
 * --------------------------*/
const PRODUCT_CARDS = {
  accessoires: {
    key: "accessoires",
    title: "Pack Accessoires Luxe",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_ACCESSOIRES.jpg?v=1769183567",
    url: "https://resell-academy.com/b/accessoires",
  },
  vetements: {
    key: "vetements",
    title: "Pack Vêtements",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_VETEMENTS.jpg?v=1769183578",
    url: "https://resell-academy.com/b/vetements",
  },
  chaussures: {
    key: "chaussures",
    title: "Pack Chaussures",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_CHAUSSURES.jpg?v=1769183578",
    url: "https://resell-academy.com/b/chaussures",
  },
  parfums: {
    key: "parfums",
    title: "Pack Parfums",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/pack_parfums.jpg?v=1769183588",
    url: "https://resell-academy.com/b/parfums",
  },
  tech: {
    key: "tech",
    title: "Pack Tech",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/Copy_of_Copy_of_COVER_PACK_CHAUSSURES.jpg?v=1769183564",
    url: "https://resell-academy.com/b/tech",
  },
  bundle: {
    key: "bundle",
    title: "Giga Bundle",
    price: "Voir prix",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_GIGA_BUNDLE_V2_GIF.png?v=1769183604",
    url: "https://resell-academy.com/b/giga-bundle",
  },
  blueprint: {
    key: "blueprint",
    title: "Resell Blueprint",
    price: "15€",
    cover:
      "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_SECONDAIRE_RESELL_BLUEPRINT.jpg?v=1769183606",
    url: "https://resell-academy.com/b/OmtC5",
  },
};

function shouldSuggestCards(userText) {
  const t = userText.toLowerCase();

  // 1) intention d’achat / demande packs
  const wantsPacks =
    t.includes("pack") ||
    t.includes("bundle") ||
    t.includes("giga") ||
    t.includes("blueprint") ||
    t.includes("prix") ||
    t.includes("acheter") ||
    t.includes("commande") ||
    t.includes("tu recommandes") ||
    t.includes("recommande");

  if (!wantsPacks) return null;

  // 2) demande explicite "quel pack pour commencer" => accessoires
  const forStart =
    t.includes("commencer") || t.includes("début") || t.includes("debutant") || t.includes("débutant");
  if (forStart) return { type: "single", key: "accessoires" };

  // 3) mention explicite d’un pack
  if (t.includes("accessoire")) return { type: "single", key: "accessoires" };
  if (t.includes("vêtement") || t.includes("vetement")) return { type: "single", key: "vetements" };
  if (t.includes("chauss")) return { type: "single", key: "chaussures" };
  if (t.includes("parfum")) return { type: "single", key: "parfums" };
  if (t.includes("tech")) return { type: "single", key: "tech" };
  if (t.includes("blueprint")) return { type: "single", key: "blueprint" };
  if (t.includes("giga")) return { type: "single", key: "bundle" };

  // sinon => tous
  return { type: "all" };
}

/** ---------------------------
 * Logging
 * --------------------------*/
async function logEvent(event) {
  try {
    // 1) Toujours dans les logs Vercel (simple)
    console.log("[RA_CHAT_EVENT]", JSON.stringify(event));

    // 2) Optionnel: webhook externe (Make/Zapier/Discord/etc.)
    // Mets RA_LOG_WEBHOOK dans Vercel si tu veux centraliser les conversations.
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

  // Preflight
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Origin soft-protection
  const origin = req.headers.origin || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  // Rate limit
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
            .slice(-8) // garde les 8 derniers pour éviter des prompts énormes
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

    const system = `
Tu es le chatbot officiel de Resell Academy.

Règles de style:
- Réponds en français par défaut.
- Ton: pro mais familial, proche, rassurant.
- Réponses courtes et actionnables (sauf question complexe).
- Si tu n'es pas sûr à 100%: ne devine pas, propose support@resell-academy.com.

Infos clés:
- Produits 100% digitaux. Accès immédiat après paiement + lien de téléchargement sur le site + email PayHip (reçu / accès).
- Si email non reçu: vérifier spams/promotions + rechercher "PayHip" + vérifier l'email de paiement. Sinon support@resell-academy.com.
- Remboursements: si le contenu a été téléchargé => pas de remboursement (sauf cas achat double / achat non autorisé selon KB).
- Délais (fournisseurs): 7 à 13 jours selon pays.
- Les liens dans les packs ne sont pas des contacts WhatsApp: ce sont des liens produits DHGate / CNFans.
- Quand tu parles du créateur, utilise "Space Resell".

UI Cards (très important):
- N'affiche PAS de cartes sans raison.
- Affiche une carte seulement si l'utilisateur demande une recommandation de pack, les packs disponibles, ou montre une intention d'achat.
- Si l'utilisateur demande "quel pack tu recommandes pour commencer", recommande toujours le Pack Accessoires Luxe (budget bas + facile pour débuter).

KNOWLEDGE BASE (source de vérité):
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
        max_tokens: 500,
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
    const reply = data?.content?.[0]?.text || "Désolé, je n’ai pas compris. Peux-tu reformuler ?";

    // Cards logic (MVP deterministic to avoid spam)
    const cardPlan = shouldSuggestCards(trimmed);
    let cards = [];
    if (cardPlan?.type === "single" && PRODUCT_CARDS[cardPlan.key]) {
      cards = [PRODUCT_CARDS[cardPlan.key]];
    } else if (cardPlan?.type === "all") {
      cards = [
        PRODUCT_CARDS.accessoires,
        PRODUCT_CARDS.chaussures,
        PRODUCT_CARDS.vetements,
        PRODUCT_CARDS.parfums,
        PRODUCT_CARDS.tech,
        PRODUCT_CARDS.bundle,
        PRODUCT_CARDS.blueprint,
      ];
    }

    // Actions (boutons intelligents non intrusifs)
    const t = trimmed.toLowerCase();
    const actions = [];

    if (t.includes("contact") || t.includes("support") || t.includes("rembourse")) {
      actions.push({
        type: "link",
        label: "Contacter le support",
        url: "https://resell-academy.com/pages/contact",
      });
    }

    if (t.includes("code promo") || t.includes("promo") || t.includes("réduction") || t.includes("reduc")) {
      actions.push({
        type: "link",
        label: "Voir les offres du moment",
        url: "https://resell-academy.com",
      });
    }

    await logEvent({
      type: "message",
      origin: origin || null,
      session: req.headers["x-ra-session"] || null,
      user: trimmed,
      hasCards: cards.length > 0,
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
