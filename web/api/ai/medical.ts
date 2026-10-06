import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing from the server environment."
      });
    }

    const question =
      typeof req.body?.question === "string"
        ? req.body.question.trim()
        : "";

    if (!question) {
      return res.status(400).json({
        error: "Question is required."
      });
    }

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4",

      instructions: `
You are AXOM Medical Intelligence.

Provide medically accurate, concise, mechanistic explanations.

Rules:
- Prioritize accuracy over agreement.
- Explain causal mechanisms.
- Distinguish established evidence from uncertainty.
- Never invent references.
- Say when information is insufficient.
- For clinical scenarios, separate education from patient-specific medical advice.
      `.trim(),

      input: question,

      max_output_tokens: 1200,

      store: false,
    });

    return res.status(200).json({
      answer: response.output_text,
      model: process.env.OPENAI_MODEL || "gpt-5.4"
    });

  } catch (error: any) {
    console.error("AXOM Medical AI error:", error);

    return res.status(500).json({
      error: error?.message || "AXOM Medical AI failed."
    });
  }
}
