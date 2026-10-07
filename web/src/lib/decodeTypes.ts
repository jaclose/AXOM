/** Additive, exportable learning overlays. Questions and attempts remain canonical. */
export interface LearningScope {
  termId?: string;
  courseId?: string;
  module?: string;
  week?: string;
  lecture?: string;
  setId?: string;
  cumulative?: boolean;
}

export interface QuestionAssignment {
  id: string;
  subjectType: "question" | "set";
  subjectId: string;
  termId?: string;
  courseId?: string;
  module: string;
  week?: string;
  lecture?: string;
  method: "manual" | "source" | "ai";
  confirmed: boolean;
  updatedAt: string;
}

export interface SourceTrace {
  documentId: string;
  page: number;
  quote: string;
  role: "question" | "answer" | "teaching" | "slide";
}

export interface DecodeDistractor {
  key: string;
  whyWrong: string;
  wouldFitIf?: string;
}

export interface QuestionAnalysis {
  id: string;
  questionId: string;
  sourceFingerprint: string;
  version: 1;
  origin: "source" | "ai";
  concept: string;
  task: string;
  rule: string;
  explanation: string;
  decisiveClues: string[];
  mechanism: string[];
  distractors: DecodeDistractor[];
  lecture?: string;
  sourcePages: number[];
  references: SourceTrace[];
  status: "proposed" | "reviewed" | "rejected";
  provider?: string;
  promptVersion?: string;
  generatedAt: string;
}

export interface DecodeSourcePack {
  id: string;
  title: string;
  documentId: string;
  setId?: string;
  checksum: string;
  fileName: string;
  pageCount: number;
  extractedPageCount: number;
  sparsePageCount: number;
  importedAt: string;
  author?: string;
  distribution: "private-local";
  rights: "user-authored" | "permission-recorded" | "unknown";
}

export interface DecodeSheet {
  id: string;
  title: string;
  scope: LearningScope;
  examDate?: string;
  createdAt: string;
  questionIds: string[];
  analysisIds: string[];
  sourceFingerprint: string;
  entries: Array<{ questionId: string; rule: string; trap?: string; references: SourceTrace[] }>;
}

export interface DecodeState {
  version: 1;
  scope: LearningScope;
  priority: "questions" | "repair" | "source";
  assignments: QuestionAssignment[];
  analyses: QuestionAnalysis[];
  packs: DecodeSourcePack[];
  sheets: DecodeSheet[];
}
