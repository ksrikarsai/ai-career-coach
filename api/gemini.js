// api/gemini.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { systemPrompt, userQuery, responseSchema } = req.body;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    return res.status(200).json(result.candidates?.[0]?.content?.parts?.[0]?.text
      ? JSON.parse(result.candidates[0].content.parts[0].text)
      : { error: "Invalid API response" });

  } catch (error) {
    console.error("Gemini API error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
