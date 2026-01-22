export default async function handler(req, res) {
  // Autorise uniquement POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "No message provided" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "Tu es le chatbot officiel de Resell Academy. Réponds clairement et utilement.",
          },
          {
            role: "user",
            content: message,
          },
        ],
      }),
    });

    // Si OpenAI renvoie une erreur, on remonte une info exploitable
    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({
        error: "OpenAI API error",
        status: response.status,
        details: errText,
      });
    }

    const data = await response.json();

    // Extraction robuste du texte
    const reply =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "Désolé, je n’ai pas compris. Peux-tu reformuler ?";

    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: String(error),
    });
  }
}
