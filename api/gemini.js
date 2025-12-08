export default async function handler(req, res) {
    try {
        const { systemPrompt, userQuery, responseSchema } = req.body;

        const apiKey = process.env.GEMINI_API_KEY;

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        };

        const result = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await result.json();

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        return res.status(200).json({
            output: JSON.parse(text)
        });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ error: err.message });
    }
}
