import type { EducationTrackId, ExperienceFocusId, Resource, TrackerItem, TrackerKind, Yield } from "./types";

export type BlueprintAudience = "sgu" | "md" | "premed" | "mcat" | "clinical" | "allied";

export interface BlueprintItem {
  title: string;
  kind: TrackerKind;
  action: string;
  done: string;
  yield?: Yield;
}

export interface BlueprintSection {
  title: string;
  source: string;
  items: BlueprintItem[];
}

export interface BlueprintResource {
  title: string;
  url: string;
  category: string;
  tags: string[];
  note: string;
}

export interface BlueprintDefinition {
  id: string;
  title: string;
  short: string;
  focusId?: ExperienceFocusId;
  trackIds: EducationTrackId[];
  audience: BlueprintAudience;
  summary: string;
  passMeaning: string;
  doneMeaning: string;
  sourceName: string;
  sourceUrl: string;
  sections: BlueprintSection[];
  resources: BlueprintResource[];
}

const officialUsmle = "USMLE Content Outline 2026";
const officialMcat = "AAMC MCAT outline / local Jack Westin AAMC-modeled topic file";
const godFile = "Blueprint Study God File v1";

export const BLUEPRINTS: BlueprintDefinition[] = [
  {
    id: "sgu-term-runway",
    title: "AXOM Term Runway",
    short: "Terms",
    focusId: "term1",
    trackIds: ["sgu"],
    audience: "sgu",
    summary: "Term-based medical structure with lectures, DLAs, PQs, and board-carry-forward habits.",
    passMeaning: "One pass means a focused cycle on a lecture, DLA, PQ set, or module repair item.",
    doneMeaning: "Lectures mature at 3-4 passes; PQs complete at 3 sets; milestones are done when the artifact exists.",
    sourceName: "AXOM term-based course map",
    sourceUrl: "https://axom.info",
    sections: [
      {
        title: "Term structure",
        source: "AXOM term-based course map",
        items: [
          row("Term course shells are loaded", "Milestone", "Confirm Term 1-5 courses match your actual schedule.", "Done when Courses has your current term map.", "high"),
          row("Module lecture/DLA/PQ import", "Milestone", "Import each module list into Course Tracker by destination path.", "Done when every active module has lecture, DLA, and PQ rows."),
          row("BSCE/CBSE carry-forward", "Review Loop", "Tag weak module concepts that recur in board-style questions.", "Done when repeat misses are retested after 48-72 hours.", "review"),
        ],
      },
      {
        title: "Execution loops",
        source: godFile,
        items: [
          row("Lecture first pass", "Lecture", "Watch/read once, extract objectives, mark confusing sections.", "Mature when recall survives PQ or Anki review.", "high"),
          row("DLA conversion", "DLA", "Turn DLA objectives into active recall prompts.", "Done when the DLA can be explained without notes."),
          row("PQ repair", "Question Block", "Complete PQs, review explanations, and tag missed mechanisms.", "Done at 3 reviewed sets or stable accuracy.", "review"),
        ],
      },
    ],
    resources: [
      resource("JD's Medical School Drive", "https://drive.google.com/drive/folders/19_3nrTD66v_oCIKlruFVidirdCAIe8yp", "Drives", ["Personal Core", "mine", "anki"], "Always-present personal medical-school drive."),
      resource("AXOM course workspace", "https://axom.info", "Medical School / Course", ["course", "axom"], "AXOM's term-based medical course workspace."),
    ],
  },
  {
    id: "usmle-step1-2026",
    title: "USMLE Step 1 Blueprint",
    short: "Step 1",
    focusId: "step1",
    trackIds: ["sgu", "usmd", "do", "img"],
    audience: "md",
    summary: "A system-based basic-science map from the official USMLE 2026 content outline.",
    passMeaning: "One pass means a question/review cycle for a system, discipline, or missed-fact cluster.",
    doneMeaning: "A domain is done when question accuracy is stable and repeat misses have been converted into recall.",
    sourceName: officialUsmle,
    sourceUrl: "https://www.usmle.org/exam-resources/step-1-materials/step-1-content-outline-and-specifications",
    sections: [
      {
        title: "Organ systems",
        source: officialUsmle,
        items: [
          row("Human development", "Review Loop", "Review normal development, aging, prevention, and milestones.", "Done when missed questions no longer cluster here."),
          row("Immune, blood, and lymphoreticular", "Review Loop", "Map immune defects, hypersensitivity, anemia, heme malignancy, and coagulation.", "Done when mechanisms drive answer choice.", "high"),
          row("Nervous system and behavioral health", "Review Loop", "Link neuroanatomy, psychiatry, senses, sleep, and behavior.", "Done when localization and diagnosis are stable.", "high"),
          row("Cardio, respiratory, renal, GI", "Review Loop", "Rotate high-yield physiology, pathology, pharm, and acid-base.", "Done when mixed-system blocks stay stable.", "high"),
          row("Endocrine, reproductive, pregnancy", "Review Loop", "Review endocrine axes, diabetes, repro, pregnancy, and breast.", "Done when disease scripts and physiology are tied together.", "high"),
          row("Biostats, epidemiology, social sciences", "Assessment", "Run biostats/ethics mini-blocks and review every missed method.", "Done after stable timed performance.", "review"),
        ],
      },
      {
        title: "Action loop",
        source: godFile,
        items: [
          row("Question block", "Question Block", "Run a timed or tutor block; record misses by system.", "Done when reviewed and logged.", "high"),
          row("Missed-fact conversion", "Evidence", "Create Anki or a repair note from repeat misses.", "Done when every repeat miss has a recall artifact.", "review"),
          row("Assessment checkpoint", "Assessment", "Take NBME/CBSSA or official-style sample set.", "Done when scores and weak areas are logged."),
        ],
      },
    ],
    resources: [
      resource("USMLE Step 1 Content Outline", "https://www.usmle.org/exam-resources/step-1-materials/step-1-content-outline-and-specifications", "STEP 1", ["official", "blueprint"], "Official Step 1 content outline and specifications."),
      resource("USMLE Step 1 Sample Questions", "https://www.usmle.org/exam-resources/step-1-materials/step-1-sample-test-questions", "STEP 1", ["official", "practice"], "Official sample questions."),
      resource("NBME CBSSA", "https://www.nbme.org/examinees/self-assessments/comprehensive-basic-science-self-assessment", "STEP 1", ["nbme", "assessment"], "Comprehensive Basic Science Self-Assessment."),
    ],
  },
  {
    id: "mcat-aamc",
    title: "MCAT Blueprint",
    short: "MCAT",
    focusId: "mcat",
    trackIds: ["premed", "mcat", "undergrad"],
    audience: "mcat",
    summary: "AAMC-style MCAT sections with content, passages, full-lengths, and error repair separated.",
    passMeaning: "One pass means a content/passages/error-log cycle for a section or content category.",
    doneMeaning: "A section is done when content gaps are closed and full-length evidence confirms stable performance.",
    sourceName: officialMcat,
    sourceUrl: "https://students-residents.aamc.org/prepare-mcat-exam/whats-mcat-exam",
    sections: [
      {
        title: "AAMC sections",
        source: officialMcat,
        items: [
          row("Chemical and Physical Foundations", "Review Loop", "Work gen chem, organic, physics, and biochem passages.", "Done when passage misses are repaired.", "high"),
          row("CARS daily passage", "Question Block", "Complete timed CARS passages and classify misses.", "Done when reviewed and timing notes are logged.", "high"),
          row("Biological and Biochemical Foundations", "Review Loop", "Review biology, biochem, experimental design, and lab reasoning.", "Done when misses become recall artifacts.", "high"),
          row("Psychological, Social, and Biological Foundations", "Review Loop", "Review psych/soc terms, behavior, social structure, and research methods.", "Done when term confusion stops repeating.", "high"),
        ],
      },
      {
        title: "Full-length loop",
        source: godFile,
        items: [
          row("Diagnostic exam", "Assessment", "Take a diagnostic or first full-length to generate baseline signal.", "Done when score and misses are logged."),
          row("Full-length review", "Assessment", "Review every missed and guessed question before adding new content.", "Done when error log categories are complete.", "review"),
          row("Retest weak category", "Question Block", "Run targeted passage sets for the highest-error category.", "Done when retest accuracy improves.", "high"),
        ],
      },
    ],
    resources: [
      resource("AAMC What's on the MCAT Exam", "https://students-residents.aamc.org/prepare-mcat-exam/whats-mcat-exam", "MCAT", ["official", "blueprint"], "Official MCAT content outline entry point."),
      resource("AAMC Prepare for the MCAT Exam", "https://students-residents.aamc.org/prepare-mcat-exam/prepare-mcat-exam", "MCAT", ["official", "practice"], "Official prep products and practice hub."),
      resource("Khan Academy MCAT", "https://www.khanacademy.org/test-prep/mcat", "MCAT", ["content", "free"], "Free MCAT content review."),
    ],
  },
  {
    id: "premed-operating-system",
    title: "Pre-Med Operating System",
    short: "Pre-Med",
    focusId: "premed",
    trackIds: ["premed", "undergrad", "mcat"],
    audience: "premed",
    summary: "A prerequisite, competency, application, and evidence vault system from the god blueprint.",
    passMeaning: "A prerequisite is a course completion or grade event; experience rows are evidence items, not study passes.",
    doneMeaning: "Done means a requirement is satisfied, evidence exists, or an application artifact is submitted.",
    sourceName: godFile,
    sourceUrl: "https://students-residents.aamc.org/applying-medical-school-amcas/applying-medical-school-amcas",
    sections: [
      {
        title: "Academic map",
        source: godFile,
        items: [
          row("Transcript or degree audit imported", "Evidence", "Enter completed courses, transfer/AP/IB credit, repeats, and withdrawals.", "Done when the academic record is auditable.", "high"),
          row("Prerequisites mapped", "Requirement", "Separate degree requirements from medical-school prerequisites.", "Done when every target-school requirement is marked complete, planned, or unknown.", "high"),
          row("Science and cumulative GPA trend", "Evidence", "Track GPA trend, repeated courses, and post-bacc/graduate work separately.", "Done when GPA risk is visible without guessing.", "review"),
        ],
      },
      {
        title: "Application evidence",
        source: godFile,
        items: [
          row("Clinical exposure", "Evidence", "Log patient-facing experiences with hours and reflections.", "Done when hours and meaning are both documented.", "high"),
          row("Service and advocacy", "Evidence", "Log non-clinical service, populations served, and reflection.", "Done when competency evidence exists."),
          row("Letters of recommendation", "Milestone", "Track evaluators, relationship quality, request dates, and status.", "Done when letters are committed/submitted.", "review"),
          row("Personal narrative vault", "Milestone", "Capture stories, hardships, growth, and patient moments while fresh.", "Done when application-worthy stories have evidence.", "high"),
        ],
      },
      {
        title: "School fit and cycle",
        source: godFile,
        items: [
          row("School list built by fit", "Milestone", "Use mission, geography, requirements, cost, stats, and fit logic.", "Done when every school has a reason beyond prestige."),
          row("Primary application", "Milestone", "Prepare AMCAS/AACOMAS/TMDSAS materials and submission date.", "Done when submitted."),
          row("Secondary essay lab", "Milestone", "Track prompts, reuse strategy, drafts, and submission status.", "Done when all target secondaries are submitted."),
        ],
      },
    ],
    resources: [
      resource("AAMC AMCAS", "https://students-residents.aamc.org/applying-medical-school-amcas/applying-medical-school-amcas", "Pre-Med", ["official", "amcas"], "Official AMCAS application hub."),
      resource("AAMC Premed Competencies", "https://students-residents.aamc.org/applying-medical-school/article/core-competencies", "Pre-Med", ["official", "competencies"], "AAMC competency framework."),
      resource("AACOMAS", "https://www.aacom.org/become-a-doctor/how-to-apply-to-osteopathic-medical-college", "Pre-Med", ["official", "do"], "Official DO application pathway entry point."),
    ],
  },
  {
    id: "clinical-step2-shelf",
    title: "Clinical / Shelf / Step 2 Blueprint",
    short: "Clinical",
    focusId: "step2",
    trackIds: ["sgu", "usmd", "do", "img"],
    audience: "clinical",
    summary: "Clinical rotations, shelf exams, NBME logic, Step 2 CK, and patient encounter evidence.",
    passMeaning: "One pass means a clinical reasoning cycle: patient/rotation task, questions, error log, and algorithm repair.",
    doneMeaning: "Done means shelf/Step 2 evidence improved or a clinical-performance artifact is captured.",
    sourceName: godFile,
    sourceUrl: "https://www.usmle.org/exam-resources/step-2-ck-materials/step-2-ck-content-outline-specifications",
    sections: [
      {
        title: "Clinical domains",
        source: "USMLE Step 2 CK / NBME shelf outlines",
        items: [
          row("Internal medicine", "Review Loop", "Build illness scripts and management algorithms from misses.", "Done when weak systems are retested.", "high"),
          row("Surgery", "Review Loop", "Track acute abdomen, trauma, perioperative, and unstable-patient logic.", "Done when next-step errors fall."),
          row("Pediatrics", "Review Loop", "Track development, prevention, emergencies, and pediatric disease scripts.", "Done when shelf misses are repaired."),
          row("OB/GYN", "Review Loop", "Track pregnancy, postpartum, gynecology, and emergencies.", "Done when algorithms are stable."),
          row("Psychiatry and family medicine", "Review Loop", "Track diagnosis, screening, prevention, risk, and ambulatory logic.", "Done when mixed blocks stabilize."),
        ],
      },
      {
        title: "Clinical evidence",
        source: godFile,
        items: [
          row("Patient encounter log", "Evidence", "Capture diagnosis, task, feedback, and learning point.", "Done when required encounter evidence is auditable.", "high"),
          row("Feedback experiment", "Milestone", "Translate feedback into one behavior to test next shift.", "Done when follow-up feedback is requested.", "review"),
          row("Shelf-to-Step 2 carry-forward", "Review Loop", "Move shelf misses into Step 2 tags instead of mentally deleting them.", "Done when the miss is retested in dedicated.", "high"),
        ],
      },
    ],
    resources: [
      resource("USMLE Step 2 CK Content Outline", "https://www.usmle.org/exam-resources/step-2-ck-materials/step-2-ck-content-outline-specifications", "STEP 2", ["official", "blueprint"], "Official Step 2 CK specifications."),
      resource("NBME Clinical Science Subject Exams", "https://www.nbme.org/subject-exams/clinical-science", "Shelf", ["official", "nbme"], "NBME shelf exam entry point."),
      resource("NBME Clinical Science Self-Assessments", "https://www.nbme.org/examinees/self-assessments/clinical-science-subject-exams", "Shelf", ["assessment", "nbme"], "Shelf-style readiness checks."),
    ],
  },
];

export function blueprintsForTrack(trackId?: EducationTrackId, focusIds: ExperienceFocusId[] = []): BlueprintDefinition[] {
  const focusSet = new Set(focusIds);
  return BLUEPRINTS.filter((blueprint) =>
    blueprint.trackIds.includes(trackId ?? "sgu") || (blueprint.focusId && focusSet.has(blueprint.focusId)),
  );
}

export function blueprintTrackerRows(blueprint: BlueprintDefinition): Array<Omit<TrackerItem, "id" | "updated">> {
  return blueprint.sections.flatMap((section) =>
    section.items.map((item) => ({
      path: `Blueprints/${blueprint.short}/${section.title}`,
      label: item.title,
      kind: item.kind,
      passes: 0,
      ankiPasses: 0,
      yield: item.yield ?? "none",
      note: `${item.action} Done: ${item.done} Source: ${section.source}.`,
    })),
  );
}

export function blueprintResourcePayload(resourceItem: BlueprintResource): Omit<Resource, "id" | "created"> {
  return {
    title: resourceItem.title,
    url: resourceItem.url,
    category: resourceItem.category,
    tags: resourceItem.tags,
    note: resourceItem.note,
    favorite: resourceItem.tags.includes("official") || resourceItem.tags.includes("mine"),
  };
}

function row(title: string, kind: TrackerKind, action: string, done: string, y: Yield = "none"): BlueprintItem {
  return { title, kind, action, done, yield: y };
}

function resource(title: string, url: string, category: string, tags: string[], note: string): BlueprintResource {
  return { title, url, category, tags, note };
}
