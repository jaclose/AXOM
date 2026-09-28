// The guide's optional AI answer. The model writes a short reply and picks
// topics by id from the catalog (a schema enum under structured outputs), so
// it can explain in its own words but only ever point at real places.
import type { AIProvider } from "../ai/types";
import { navById } from "../../components/shell/nav";
import { GUIDE_TOPICS, guideTopicById, type GuideTopic } from "./topics";
import { matchGuideTopics } from "./match";

export const GUIDE_QUESTION_MAX = 500;

export interface GuideAnswer {
  text: string;
  topics: GuideTopic[];
}

const GUIDE_SYSTEM = `You are the guide inside AXOM, a study app for medical students. Answer questions about using AXOM in one to three short sentences, then pick the topics that show the learner where to go.

Describe only features from the topic list. If AXOM can't do something, say so plainly and name the closest feature when one fits. Never invent buttons, pages or settings. If the question is about medicine rather than the app, say that you help with using AXOM and point to its AI study tools when one fits.

Reply with JSON: {"answer": string, "topicIds": string[]}. topicIds holds up to three ids from the list, most useful first, or none.`;

const GUIDE_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    topicIds: { type: "array", items: { type: "string", enum: GUIDE_TOPICS.map((topic) => topic.id) } },
  },
  required: ["answer", "topicIds"],
  additionalProperties: false,
};

const CATALOG = GUIDE_TOPICS.map((topic) => `- ${topic.id}: ${topic.title}. ${topic.summary}`).join("\n");

export async function askGuide(provider: AIProvider, question: string, context: { route: string }): Promise<GuideAnswer> {
  const asked = question.trim().slice(0, GUIDE_QUESTION_MAX);
  if (!asked) throw new Error("Ask a question first.");
  const page = navById(context.route)?.label ?? context.route;
  const raw = await provider.completeJson({
    task: "guide.ask",
    system: GUIDE_SYSTEM,
    prompt: `Topics:\n${CATALOG}\n\nThe learner is on: ${page}\nQuestion: ${asked}`,
    maxTokens: 400,
    schema: GUIDE_SCHEMA,
  });
  const record = raw && typeof raw === "object" ? raw as { answer?: unknown; topicIds?: unknown } : {};
  const text = typeof record.answer === "string" ? record.answer.trim().slice(0, 800) : "";
  if (!text) throw new Error("The guide didn't return an answer.");
  const ids = Array.isArray(record.topicIds) ? record.topicIds.filter((id): id is string => typeof id === "string") : [];
  const chosen = [...new Set(ids)].map(guideTopicById).filter((topic): topic is GuideTopic => Boolean(topic)).slice(0, 3);
  // A reply without destinations still gets the closest local matches.
  return { text, topics: chosen.length ? chosen : matchGuideTopics(asked, 3).map((match) => match.topic) };
}
