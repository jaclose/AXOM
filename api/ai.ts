import { runAiFeature, type AiFeature, type AiRequestBody } from "../lib/api/aiService.js";
import { ApiError, getOptionalParam, requireBodyObject, sendJson, withApi } from "../lib/api/http.js";

const AI_FEATURES: AiFeature[] = [
  "next-move",
  "anki-generator",
  "step-planner",
  "weak-area-analysis",
  "daily-report",
];

export default withApi(["POST"], async (req, res) => {
  const body = requireBodyObject(req, 64_000) as AiRequestBody;
  const feature = parseFeature(getOptionalParam(req, "feature") || body.feature);
  const result = await runAiFeature(feature, body);
  sendJson(res, result);
}, { rateLimit: 30 });

function parseFeature(value: unknown): AiFeature {
  const feature = typeof value === "string" ? value.trim() : "";
  if ((AI_FEATURES as string[]).includes(feature)) return feature as AiFeature;
  throw new ApiError(400, "Invalid AI feature.");
}
