export default async function handler(req: any, res: any) {
  return res.status(200).json({
    ok: true,
    route: "openai-smoke",
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || null
  });
}
