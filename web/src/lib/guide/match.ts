// Local, offline matching of a question to guide topics. It needs no AI, so
// the guide works for everyone; the optional AI answer only refines it.
import { GUIDE_TOPICS, guideTopicById, type GuideTopic } from "./topics";

const STOP_WORDS = new Set([
  "a", "an", "and", "any", "are", "be", "can", "could", "do", "does", "find", "for", "get", "go", "help", "how",
  "i", "in", "is", "it", "me", "my", "need", "of", "on", "or", "please", "should", "some", "the", "there", "this",
  "to", "use", "want", "way", "what", "where", "which", "with", "would", "you", "your",
]);

// Phrases whose words mean something else apart ("log in" is not a study log).
const PHRASES: Array<[RegExp, string]> = [
  [/\blog ?(?:in|on)\b/g, "login"],
  [/\bsign ?in\b/g, "sign"],
  [/\bsign ?up\b/g, "signup"],
  [/\bto ?do\b/g, "todo"],
  [/\bturn on\b|\bswitch on\b/g, "enable"],
  [/\bpre ?med\b/g, "premed"],
  [/\bq ?bank\b/g, "question"],
];

// Everyday words mapped to the vocabulary the topics use.
const SYNONYMS: Record<string, string> = {
  flashcard: "card", deck: "card", mcq: "question", uworld: "question", amboss: "question",
  quiz: "practice", signin: "sign", logout: "sign", register: "signup",
  stat: "report", analytic: "report", graph: "report", music: "sound", noise: "sound",
  night: "dark", colour: "color", bug: "feedback", crash: "feedback", recover: "restore",
};

/** Lowercase, drop stop words, fold simple plurals and endings. */
export function guideTokens(text: string): string[] {
  let normalized = text.toLowerCase();
  for (const [pattern, replacement] of PHRASES) normalized = normalized.replace(pattern, replacement);
  return normalized
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .map(stem)
    .map((word) => SYNONYMS[word] ?? word);
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && /(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

interface Indexed {
  topic: GuideTopic;
  keywords: Set<string>;
  title: Set<string>;
  summary: Set<string>;
  /** Unnormalized keyword and title words, for matching a half-typed word. */
  words: string[];
}

const INDEX: Indexed[] = GUIDE_TOPICS.map((topic) => ({
  topic,
  keywords: new Set(topic.keywords.flatMap(guideTokens)),
  title: new Set(guideTokens(topic.title)),
  summary: new Set(guideTokens(topic.summary)),
  words: [...topic.keywords, topic.title].join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3),
}));

export interface GuideMatch {
  topic: GuideTopic;
  score: number;
}

/** Best topics for a question, strongest first; ties keep catalog order. */
export function matchGuideTopics(query: string, limit = 4): GuideMatch[] {
  const words = [...new Set(guideTokens(query))];
  if (!words.length) return [];
  return INDEX
    .map(({ topic, keywords, title, summary, words: known }) => {
      let score = 0;
      for (const word of words) {
        if (keywords.has(word)) score += 3;
        else if (title.has(word)) score += 2;
        // A half-typed word ("flashc", "pomod") counts like a title word.
        else if (word.length >= 3 && known.some((candidate) => candidate.startsWith(word))) score += 2;
        else if (summary.has(word)) score += 1;
      }
      return { topic, score };
    })
    .filter((match) => match.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export const POPULAR_GUIDE_TOPICS: readonly GuideTopic[] = [
  "anki-generate", "questions-generate", "command-brief", "account", "ai-settings", "backup",
].map((id) => guideTopicById(id)!);
