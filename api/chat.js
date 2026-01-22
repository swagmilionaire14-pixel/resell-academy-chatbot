export default async function handler(req, res) {
  // POST only
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "No message provided" });
    }

    // Appel Anthropic Claude Messages API
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        // requis par Anthropic
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Modèle conseillé “généraliste” (tu peux changer ensuite)
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
        // Optionnel mais utile : style/consignes
        system:
          "Tu es le chatbot officiel de Resell Academy. Réponds clairement et utilement. Si tu n'es pas sûr, pose une question courte.",
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(500).json({
        error: "Anthropic API error",
        status: r.status,
        details: errText,
      });
    }

    const data = await r.json();

    // Claude renvoie généralement: data.content = [{ type: "text", text: "..." }, ...]
    const reply =
      data?.content?.find?.((c) => c.type === "text")?.text ||
      "Désolé, je n’ai pas compris. Peux-tu reformuler ?";

    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
