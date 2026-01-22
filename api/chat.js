export default async function handler(req, res) {
  // =========================
  // CORS (obligatoire pour PayHip)
  // =========================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Réponse au preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Autoriser uniquement POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "No message provided" });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 400,
        system:
          "Tu es le chatbot officiel de Resell Academy. Réponds clairement, simplement et de façon professionnelle.",
        messages: [
          {
            role: "user",
            content: message
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({
        error: "Anthropic API error",
        details: err
      });
    }

    const data = await response.json();

    const reply =
      data?.content?.[0]?.text ||
      "Désolé, je n’ai pas compris. Peux-tu reformuler ?";

    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: String(error)
    });
  }
}
