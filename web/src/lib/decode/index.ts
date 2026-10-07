// Decode: what a source teaches about a question. See ./types for where it
// sits between the course engine, the attempts and learning intelligence.
export { ANALYSIS_LIMITS, type AnalysisOrigin, type AnalysisStatus, type DistractorNote, type QuestionAnalysis, type SourceTrace } from "./types";
export { mergeQuestionAnalyses, normalizeQuestionAnalyses, normalizeQuestionAnalysis, traceQuote } from "./normalize";
export {
  analysisIsCurrent, analysisPages, currentTeaching, pendingAnalyses, questionSourceFingerprint, questionSourcePages,
  withAnalysis, withAnalysisStatus,
} from "./analysis";
