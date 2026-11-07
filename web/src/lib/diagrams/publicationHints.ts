import type { QuestionRecord } from "../questions";

/**
 * Text-only requests for future AXOM art and licensed medical imagery.
 *
 * These hints are deliberately derived from explicit subject vocabulary,
 * never from a speculative differential diagnosis. They do not attach,
 * download, publish, or claim to validate an image.
 */
export type MedicalVisualKind =
  | "anatomical-schematic"
  | "histology-micrograph"
  | "pathology-comparison"
  | "gross-pathology-specimen"
  | "microbiology-image"
  | "mechanism-diagram"
  | "none";

export interface MedicalVisualPlan {
  kind: MedicalVisualKind;
  keywords: string[];
  /** Only vetted, source-checked artwork may satisfy a request. */
  requiresMedicalReview: true;
  /** Remains empty until a licensed or AXOM-owned asset is separately reviewed. */
  assetId: null;
}

export type VisualPlanningQuestion = Pick<QuestionRecord, "stem" | "topic" | "category" | "subcategory" | "system" | "tags">;

const LEXICON: readonly string[] = [
  "brachial plexus", "posterior cord", "cranial nerve", "inguinal canal",
  "inferior epigastric", "cardiac conduction", "spinal cord", "peripheral nerve",
  "fibrocartilage", "chondrocytes", "lacunae", "collagen", "epithelium",
  "photomicrograph", "hematoxylin", "eosin", "neutrophils", "glomerulus",
  "atherosclerosis", "fibrous cap", "necrotic core", "foam cells", "granuloma",
  "dysplasia", "neoplasm", "necrosis", "infarction",
  "gross specimen", "gross pathology", "cut surface", "resected specimen", "autopsy",
  "gram stain", "fungal hyphae", "acid-fast", "protozoa", "bacteria",
  "action potential", "feedback loop", "receptor signaling", "enzyme inhibition",
];

const DOMAIN_RULES: readonly { kind: Exclude<MedicalVisualKind, "none">; pattern: RegExp }[] = [
  { kind: "histology-micrograph",
    pattern: /\b(?:histolog(?:y|ical)|histopatholog(?:y|ical)|photomicrograph|microscop(?:y|ic)|h\s*&\s*e|hematoxylin|chondrocytes|lacunae)\b/i },
  { kind: "anatomical-schematic",
    pattern: /\b(?:anatomy|anatomical|brachial plexus|posterior cord|cranial nerve|inguinal canal|inferior epigastric|spinal cord)\b/i },
  { kind: "gross-pathology-specimen",
    pattern: /\b(?:gross specimen|gross pathology|gross appearance|cut surface|resected specimen|organ specimen|autopsy)\b/i },
  { kind: "pathology-comparison",
    pattern: /\b(?:patholog(?:y|ical)|atherosclerosis|fibrous cap|necrotic core|granuloma|dysplasia|neoplasm|necrosis|infarction)\b/i },
  { kind: "microbiology-image",
    pattern: /\b(?:microbiolog(?:y|ical)|gram stain|fungal hyphae|acid-fast|protozoa|bacteria)\b/i },
  { kind: "mechanism-diagram",
    pattern: /\b(?:physiolog(?:y|ical)|pharmacolog(?:y|ical)|action potential|feedback loop|receptor signaling|enzyme inhibition)\b/i },
];

function tidy(value: string): string {
  return value.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

function matchesPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(haystack);
}

export function planMedicalVisual(question: VisualPlanningQuestion): MedicalVisualPlan {
  const metadata = [question.topic, question.category, question.subcategory, question.system, ...(question.tags ?? [])]
    .filter((value): value is string => typeof value === "string").map(tidy);
  const explicit = tidy([question.stem, ...metadata].join(" "));
  const kind = DOMAIN_RULES.find(rule => rule.pattern.test(explicit))?.kind ?? "none";
  if (kind === "none") return { kind, keywords: [], assetId: null, requiresMedicalReview: true };
  const keywords = new Set<string>();
  // Subject metadata is explicit author context, not a medical conclusion.
  const topic = tidy(question.topic ?? "");
  if (topic.length >= 3 && topic.length <= 64 && !/^(?:general|other|unknown|unclassified)$/.test(topic)) keywords.add(topic);
  for (const phrase of LEXICON) if (matchesPhrase(explicit, phrase)) keywords.add(phrase);
  return { kind, keywords: [...keywords].slice(0, 10), assetId: null, requiresMedicalReview: true };
}

/**
 * Discovery endpoints are references only. An openly accessible website does
 * not establish rights to redistribute, modify, or use its individual images.
 */
export const MEDICAL_IMAGE_SOURCE_CATALOG = [
  { id: "nci-idc", title: "NCI Imaging Data Commons",
    url: "https://datacommons.cancer.gov/repository/imaging-data-commons",
    topics: ["pathology", "oncology", "radiology"], licenseStatus: "per-asset-review" },
  { id: "cdc-phil", title: "CDC Public Health Image Library",
    url: "https://wwwn.cdc.gov/phil/",
    topics: ["microbiology", "infectious disease", "pathology"], licenseStatus: "per-asset-review" },
  { id: "openstax", title: "OpenStax Anatomy & Physiology",
    url: "https://openstax.org/subjects/science", topics: ["anatomy", "physiology"],
    licenseStatus: "per-asset-review" },
  { id: "nlm-openi", title: "NLM Open-i",
    url: "https://openi-vip.nlm.nih.gov/",
    topics: ["radiology", "histology", "pathology"], licenseStatus: "per-asset-review" },
] as const;

export interface MedicalAssetRights {
  rightsReviewed: boolean;
  redistributionAllowed: boolean;
  modificationsAllowed: boolean;
  /** A source/author/license string even when an asset does not demand a byline. */
  attribution: string;
}

export function canEmbedMedicalAsset(rights: MedicalAssetRights): boolean {
  return rights.rightsReviewed === true && rights.redistributionAllowed === true
    && rights.modificationsAllowed === true && rights.attribution.trim().length > 0;
}
