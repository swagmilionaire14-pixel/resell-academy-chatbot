// /api/chat.js
import fs from "fs";
import path from "path";

const ALLOWED_ORIGINS = new Set([
  "https://resell-academy.com",
  "https://www.resell-academy.com",
  "https://payhip.com",
  "https://www.payhip.com",
]);

/**
 * Petit rate limit en mémoire (ok pour MVP).
 * Si tu veux solide en prod: Upstash Redis / Vercel KV.
 */
const RL_WINDOW_MS = 60_000;
const RL_MAX_REQ = 20;
const rlMap = new Map();

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function rateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = rlMap.get(ip) || { count: 0, start: now };

  if (now - entry.start > RL_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }

  entry.count += 1;
  rlMap.set(ip, entry);

  const remaining = Math.max(0, RL_MAX_REQ - entry.count);
  const retryAfterSec = Math.ceil((RL_WINDOW_MS - (now - entry.start)) / 1000);

  return {
    ok: entry.count <= RL_MAX_REQ,
    remaining,
    retryAfterSec,
  };
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function loadKnowledge() {
  try {
    // Chemin: /api/knowledge/ra_knowledge.txt (comme ton repo)
    const kbPath = path.join(process.cwd(), "api", "knowledge", "ra_knowledge.txt");
    const text = fs.readFileSync(kbPath, "utf8");
    return { text, warning: null };
  } catch (e) {
    return { text: "", warning: "Knowledge file not found or unreadable." };
  }
}

/**
 * Catalogue des cards (MVP).
 * IMPORTANT:
 * - Pour “Ajouter au panier” sans redirection, il te faut le data-product Payhip de chaque pack.
 * - Pour l’instant on met payhipProductId: null => le bouton redirige vers l’URL.
 */
const PRODUCT_CARDS = {
  accessoires: {
    key: "accessoires",
    name: "Pack Accessoires Luxe",
    price: "Voir prix",
    url: "https://resell-academy.com/b/accessoires",
    cover: "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_ACCESSOIRES.jpg?v=1769183567",
    payhipProductId: null, // <-- mets l’ID Payhip quand tu l’as (data-product="XXXXX")
  },
  vetements: {
    key: "vetements",
    name: "Pack Vêtements",
    price: "Voir prix",
    url: "https://resell-academy.com/b/vetements",
    cover: "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_VETEMENTS.jpg?v=1769183578",
    payhipProductId: null,
  },
  chaussures: {
    key: "chaussures",
    name: "Pack Chaussures",
    price: "Voir prix",
    url: "https://resell-academy.com/b/chaussures",
    cover: "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_PACK_CHAUSSURES.jpg?v=1769183578",
    payhipProductId: null,
  },
  parfums: {
    key: "parfums",
    name: "Pack Parfums",
    price: "Voir prix",
    url: "https://resell-academy.com/b/parfums",
    cover: "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/pack_parfums.jpg?v=1769183588",
    payhipProductId: null,
  },
  tech: {
    key: "tech",
    name: "Pack Tech",
    price: "Voir prix",
    url: "https://resell-academy.com/b/tech",
    cover: "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/Copy_of_Copy_of_COVER_PACK_CHAUSSURES.jpg?v=1769183564",
    payhipProductId: null,
  },
  bundle: {
    key: "bundle",
    name: "Giga Bundle",
    price: "Voir prix",
    url: "https://resell-academy.com/b/giga-bundle",
    cover: "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_GIGA_BUNDLE_V2_GIF.png?v=1769183604",
    payhipProductId: null,
  },
  blueprint: {
    key: "blueprint",
    name: "Resell Blueprint",
    price: "15€",
    url: "https://resell-academy.com/b/OmtC5",
    cover: "https://cdn.shopify.com/s/files/1/0973/2368/0110/files/COVER_SECONDAIRE_RESELL_BLUEPRINT.jpg?v=1769183606",
    payhipProductId: null,
  },
};

function shouldSuggestCards(userText) {
  const t = userText.toLowerCase();

  // 1) Cas “je ne sais pas quel pack choisir / conseille-moi”
  if (
    t.includes("quel pack") ||
    t.includes("tu me conseilles") ||
    t.includes("tu recommandes") ||
    t.includes("je commence") ||
    t.includes("débutant") ||
    t.includes("par où commencer")
  ) return { type: "single", key: "accessoires" };

  // 2) Cas “packs disponibles / liste des packs”
  if (t.includes("packs") || t.includes("bundle") || t.includes("giga")) {
    return { type: "all" };
  }

  // 3) Mention explicite d’un pack
  if (t.includes("accessoire")) return { type: "single", key: "accessoires" };
  if (t.includes("vêtement")) return { type: "single", key: "vetements" };
  if (t.includes("chauss")) return { type: "single", key: "chaussures" };
  if (t.includes("parfum")) return { type: "single", key: "parfums" };
  if (t.includes("tech")) return { type: "single", key: "tech" };
  if (t.includes("blueprint")) return { type: "single", key: "blueprint" };
  if (t.includes("giga")) return { type: "single", key: "bundle" };

  return null;
}

export default async function handler(req, res) {
  setCors(req, res);

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limit
  const rl = rateLimit(req);
  res.setHeader("X-RateLimit-Limit", String(RL_MAX_REQ));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
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

    const trimmed = message.trim();
    if (!trimmed) return res.status(400).json({ error: "Empty message" });
    if (trimmed.length > 1200) return res.status(400).json({ error: "Message too long" });

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
    const reply =
      data?.content?.[0]?.text ||
      "Désolé, je n’ai pas compris. Peux-tu reformuler ?";

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

    return res.status(200).json({
      reply,
      cards, // <= nouveau
      kbWarning: warning || null,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: String(error),
    });
  }
}
