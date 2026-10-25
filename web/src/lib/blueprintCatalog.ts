// ===========================================================================
// Blueprint catalog — the canonical, source-governed content + architecture for
// every exam lane, anchored to the "Blueprint Study God File" and the official
// USMLE / AAMC / NBME / ADA / Acuity outlines. This is a TEMPLATE library; the
// store instantiates per-user InstalledBlueprint containers from these entries.
//
// Authoring rules (from the god file):
//   - Never flatten a lane into lecture "passes". Every node has a real taskType.
//   - Official sources govern; third-party tools are labeled as tools.
//   - For CASPer/DAT, the schema + install architecture is built now and content
//     is scaffolded against the official testing authority (not invented depth).
// ===========================================================================
import type {
  BlueprintLaneId, BlueprintMode, BlueprintNodeType, BlueprintPriority,
  BlueprintResourceLink, BlueprintSource,
} from "./types";

export interface CatalogNode {
  objective: string;
  taskType: BlueprintNodeType;
  detail?: string;
  subCategory?: string;
  priority?: BlueprintPriority;
  estimatedMinutes?: number;
  tags?: string[];
  source?: BlueprintSource;        // overrides the blueprint source (e.g. a tool)
  resourceLinks?: BlueprintResourceLink[];
}

export interface CatalogCategory {
  name: string;
  summary?: string;
  nodes: CatalogNode[];
}

export interface BlueprintCatalogEntry {
  id: string;            // blueprintId
  laneId: BlueprintLaneId;
  title: string;         // installed container name
  short: string;
  summary: string;
  version: number;
  source: BlueprintSource;
  crossTags: string[];   // the lane's cross-tag taxonomy
  categories: CatalogCategory[];
}

export interface BlueprintLane {
  id: BlueprintLaneId;
  mode: BlueprintMode;
  label: string;
  sub: string;
  blueprintId: string;   // primary master blueprint for the lane
}

// Deterministic node id so user progress survives catalog/schema updates.
export function catalogNodeId(blueprintId: string, category: string, objective: string): string {
  return `${blueprintId}::${category}::${objective}`;
}

// ---- Source records (official sources govern) -----------------------------
const AUDIT_DATE = "2026-06-22";
const official = (name: string, url: string, sourceVersion: string, changeLog: string): BlueprintSource =>
  ({
    type: "official",
    name,
    url,
    lastVerified: AUDIT_DATE,
    verification: "source-audited",
    confidence: "high",
    sourceVersion,
    changeLog,
    auditNote: "Source-audited by AXOM; not user-confirmed verified.",
  });
const tool = (name: string, url: string, sourceVersion = "Tool source; not governing curriculum"): BlueprintSource =>
  ({
    type: "tool",
    name,
    url,
    lastVerified: AUDIT_DATE,
    verification: "source-audited",
    confidence: "medium",
    sourceVersion,
    changeLog: "Tool/support source only; official sources govern curriculum and policy.",
    auditNote: "Tool source-audited by AXOM; not user-confirmed verified.",
  });
const internal = (name: string): BlueprintSource =>
  ({ type: "internal", name, verification: "unverified", confidence: "medium" });

const SRC = {
  usmleStep1: official("USMLE Step 1 Exam Content", "https://www.usmle.org/exam-resources/step-1-materials/step-1-content-outline-and-specifications", "USMLE web page + 2026 integrated content outline", "Audited Step 1 system, competency, and discipline ranges on 2026-06-22."),
  usmleStep2: official("USMLE Step 2 CK Exam Content", "https://www.usmle.org/exam-resources/step-2-ck-materials/step-2-ck-content-outline-specifications", "USMLE web page + 2026 integrated content outline", "Audited Step 2 CK 2026 format change, system/discipline ranges, and physician-task framing on 2026-06-22."),
  usmleStep3: official("USMLE Step 3 Content Outline and Specifications", "https://www.usmle.org/exam-resources/step-3-materials/step-3-content-outline-and-specifications", "USMLE web page + 2026 integrated content outline", "Audited Step 3 role, sites of care, and CCS/independent-practice framing on 2026-06-22."),
  nbmeShelf: official("NBME Clinical Science Subject Exams", "https://www.nbme.org/educators/assess-learn/subject-exams/clinical-science", "NBME clinical science subject exam page, ©2025 page footer", "Audited subject-exam reporting/resources page and norms/reporting notes on 2026-06-22."),
  aamcMcat: official("AAMC What's on the MCAT Exam?", "https://students-residents.aamc.org/prepare-mcat-exam/whats-mcat-exam-pdf-outline", "AAMC MCAT PDF outline page, ©2026 page footer", "Audited AAMC four-section/content-outline framing on 2026-06-22."),
  aamcComp: official("AAMC Premed Competencies", "https://students-residents.aamc.org/real-stories-demonstrating-premed-competencies/premed-competencies-entering-medical-students", "AAMC competencies page, updated competency titles noted in 2026", "Audited AAMC competency model and 2026 title update note on 2026-06-22."),
  amcas: official("AAMC AMCAS Program", "https://students-residents.aamc.org/applying-medical-school-amcas/apply-medical-school-amcas-program", "AAMC AMCAS page, 2027 applicant-guide link visible", "Audited AMCAS landing page and current guide link on 2026-06-22."),
  casper: official("Acuity Insights Casper", "https://acuityinsights.app/casper/", "Acuity Casper page, 2 sections / 11 scenarios", "Audited Casper format, timing, scenario count, and score-delivery notes on 2026-06-22."),
  dat: official("ADA 2026 DAT Candidate Guide", "https://www.ada.org/-/media/project/ada-organization/ada/ada-org/files/education/dat_candidate_guide.pdf", "2026 DAT Candidate Guide, updated 2025-12-11", "Audited ADA candidate guide search-result metadata and official PDF URL on 2026-06-22."),
  jackWestin: tool("Jack Westin MCAT topic outline", "https://jackwestin.com/resources/mcat-content/science-topic-outline-for-the-mcat-exam", "Jack Westin expanded MCAT outline captured locally 2026-06-20"),
  godFile: internal("Blueprint Study God File v1"),
} as const;

// ---- Authoring helpers -----------------------------------------------------
function n(objective: string, taskType: BlueprintNodeType, opts: Partial<CatalogNode> = {}): CatalogNode {
  return { objective, taskType, priority: "medium", ...opts };
}
function cat(name: string, summary: string, nodes: CatalogNode[]): CatalogCategory {
  return { name, summary, nodes };
}
function nodes(
  items: string[],
  taskType: BlueprintNodeType,
  tags: string[],
  source: BlueprintSource,
  priority: BlueprintPriority = "medium",
): CatalogNode[] {
  return items.map((item) => n(item, taskType, { source, priority, tags }));
}

// Shared category builders reused across lanes (keeps the model consistent).
const qbankCategory = (label = "Question Bank Center") => cat(label,
  "Timed blocks, review discipline, and accuracy tracked by tag — questions are the map.",
  [
    n("Daily timed block", "task", { priority: "high", estimatedMinutes: 60, tags: ["questions"] }),
    n("Tutor / untimed remediation block", "task", { tags: ["questions", "review"] }),
    n("Accuracy by tag dashboard", "metric", { tags: ["questions", "analytics"] }),
    n("Explanation-review discipline (every miss + every guess)", "task", { priority: "high", tags: ["questions", "review"] }),
  ]);
const errorLogCategory = () => cat("Error Log and Weakness Repair",
  "Every miss becomes a tagged, retested repair item — not a deleted memory.",
  [
    n("Capture miss with mechanism + error type", "tracker", { priority: "high", tags: ["error-log"] }),
    n("48–72h retest queue", "queue", { priority: "high", tags: ["error-log", "spaced"] }),
    n("Recurring-weakness ranking", "metric", { tags: ["error-log", "analytics"] }),
  ]);
const ankiCategory = () => cat("Anki / Spaced Repetition",
  "Convert repeat misses into durable recall; keep reviews honest.",
  [
    n("Repeat-miss → card pipeline", "task", { priority: "high", tags: ["anki"] }),
    n("Mature vs. lapsed review balance", "metric", { tags: ["anki", "analytics"] }),
    n("Daily review ceiling (protect the floor, not the maximum)", "task", { tags: ["anki"] }),
  ]);
const assessmentCategory = (label = "NBME / Assessment Center") => cat(label,
  "Spaced, official-style checkpoints; review before adding new content.",
  [
    n("Baseline assessment logged", "assessment", { priority: "high", tags: ["assessment"] }),
    n("Assessment calendar (spaced)", "planner", { tags: ["assessment", "planner"] }),
    n("Two-pass assessment review", "task", { priority: "high", tags: ["assessment", "review"] }),
  ]);
const dedicatedPlannerCategory = (label = "Dedicated Planner") => cat(label,
  "A planning + execution layer that attaches to the exam — not a second exam.",
  [
    n("Baseline diagnostic", "assessment", { priority: "high", tags: ["dedicated"] }),
    n("Weakness ranking → resource selection", "tracker", { tags: ["dedicated"] }),
    n("Daily plan generator (timed blocks)", "planner", { tags: ["dedicated", "planner"] }),
    n("Simulation + taper phases", "planner", { tags: ["dedicated"] }),
    n("Sleep / recovery safeguards", "task", { tags: ["dedicated", "wellness"] }),
  ]);
const testDayCategory = (label = "Test-Day Readiness") => cat(label,
  "Logistics and the last-mile checklist so prep isn't wasted at the door.",
  [
    n("Exam logistics (ID, center, timing, breaks plan)", "task", { tags: ["logistics"] }),
    n("Final-week taper + simulation", "planner", { tags: ["logistics"] }),
    n("Day-before + day-of checklist", "task", { priority: "high", tags: ["logistics"] }),
  ]);

const ORGAN_SYSTEMS = [
  "Immune system", "Blood & lymphoreticular", "Behavioral health", "Nervous system & special senses",
  "Skin & subcutaneous", "Musculoskeletal", "Cardiovascular", "Respiratory", "Gastrointestinal",
  "Renal & urinary", "Pregnancy/childbirth/puerperium", "Female reproductive & breast",
  "Male reproductive", "Endocrine", "Multisystem / general principles",
];

const USMLE_CONTENT_AREAS = [
  "Human development and care of the well patient",
  "Immune system",
  "Blood and lymphoreticular system",
  "Behavioral health",
  "Nervous system and special senses",
  "Skin and subcutaneous tissue",
  "Musculoskeletal system",
  "Cardiovascular system",
  "Respiratory system",
  "Gastrointestinal system",
  "Renal and urinary system",
  "Pregnancy, childbirth, and puerperium",
  "Female and transgender reproductive system and breast",
  "Male and transgender reproductive system",
  "Endocrine system",
  "Multisystem processes and disorders",
  "Biostatistics, epidemiology, population health, and medical literature",
  "Social sciences",
];

const STEP1_DISCIPLINES = [
  "Pathology mechanism map",
  "Physiology mechanism map",
  "Nutrition across systems",
  "Gross anatomy and embryology",
  "Microbiology and host response",
  "Pharmacology mechanisms, toxicities, and interactions",
  "Behavioral science",
  "Biochemistry and metabolism",
  "Histology and cell biology",
  "Immunology",
  "Genetics",
];

const STEP2_CLINICAL_TASKS = [
  "Diagnosis and differential selection",
  "Next best diagnostic step",
  "Initial management and stabilization",
  "Longitudinal management and follow-up interval",
  "Health maintenance and screening",
  "Risk factor modification and prevention",
  "Prognosis, complications, and counseling",
  "Patient safety and quality improvement",
  "Legal/ethical decision-making",
  "Interpretation of abstracts, drug ads, and evidence",
];

const STEP3_SITES_OF_CARE = [
  "Ambulatory office and community health center",
  "Home care and outpatient hospice",
  "Inpatient ward and short-stay observation",
  "ICU/CCU and acute rehabilitation",
  "Emergency department",
  "Skilled nursing / extended-care facility",
  "Telephone or chart-based management",
];

const MCAT_FOUNDATIONAL_CONCEPTS = [
  "FC1: biomolecules and protein function",
  "FC2: cells and assemblies of molecules",
  "FC3: organ systems and biological integration",
  "FC4: physical principles in living systems",
  "FC5: chemical principles and molecular behavior",
  "FC6: sensing, behavior, and response",
  "FC7: biological, psychological, and sociocultural influences",
  "FC8: self, identity, and social interaction",
  "FC9: social structure and demographics",
  "FC10: social inequality",
];

const MCAT_CONTENT_CATEGORIES = [
  "1A proteins and amino acids",
  "1B genetic information flow",
  "1C inheritance and biotechnology",
  "1D bioenergetics and fuel metabolism",
  "2A cell structure and function",
  "2B growth, physiology, and genetics of prokaryotes/eukaryotes",
  "2C cell division, differentiation, and specialization",
  "3A nervous and endocrine control",
  "3B organ systems, homeostasis, and integration",
  "4A motion, force, work, and energy",
  "4B fluids and circulation",
  "4C electrochemistry and circuits",
  "4D light, sound, and matter",
  "4E atoms, nuclear decay, and electronic structure",
  "5A water, solutions, and acid-base",
  "5B molecular structure and interactions",
  "5C separation and purification methods",
  "5D organic reactivity",
  "5E thermodynamics and kinetics",
  "6A sensation and perception",
  "6B making sense of the environment",
  "6C responding to the world",
  "7A behavior and behavior change",
  "7B social processes",
  "7C attitude and behavior change",
  "8A self-identity",
  "8B social thinking",
  "8C social interactions",
  "9A social structure",
  "9B demographics",
  "10A social inequality",
];

const AAMC_COMPETENCIES = [
  "Commitment to learning and growth",
  "Empathy and compassion",
  "Ethical responsibility to self and others",
  "Interpersonal skills",
  "Oral communication",
  "Reliability and dependability",
  "Resilience and adaptability",
  "Service orientation",
  "Teamwork and collaboration",
  "Self-awareness",
  "Understanding others",
  "Critical thinking",
  "Quantitative reasoning",
  "Scientific inquiry",
  "Written communication",
  "Living systems",
  "Human behavior",
];

const RESEARCH_MILESTONES = [
  "Literature review and question framing",
  "Research ethics / training completion",
  "Protocol or methods contribution",
  "Data collection or chart review",
  "Data cleaning and analysis",
  "Abstract drafted or submitted",
  "Poster or oral presentation",
  "Manuscript contribution",
  "Submission, publication, grant, or award",
];

const STEP1_BIOCHEM_MOLECULAR = [
  "DNA replication enzymes, directionality, and repair defects",
  "Transcription, RNA processing, translation, and gene-expression regulation",
  "Epigenetics, imprinting, anticipation, mosaicism, and mitochondrial inheritance",
  "Mendelian inheritance, pedigree interpretation, and probability shortcuts",
  "Chromosomal disorders, nondisjunction, deletions, and translocations",
  "Hardy-Weinberg allele and genotype frequency calculations",
  "Oncogenes, tumor suppressor genes, two-hit logic, and cancer syndromes",
  "Signal transduction pathways and second messenger systems",
  "Enzyme kinetics, inhibition, Km/Vmax shifts, and rate-limiting steps",
  "Vitamin and cofactor deficiencies with neurologic, hematologic, and metabolic clues",
  "Glycolysis, gluconeogenesis, TCA cycle, ETC, and oxidative phosphorylation",
  "Pentose phosphate pathway, glycogen storage, fructose/galactose metabolism",
  "Fatty acid synthesis, beta-oxidation, ketone metabolism, and carnitine shuttle",
  "Urea cycle, purine/pyrimidine synthesis, organic acidemias, and amino-acid metabolism",
];

const STEP1_IMMUNOLOGY_CONTENT = [
  "Innate immunity cells, receptors, inflammation signals, and complement activation",
  "Adaptive immunity: antigen presentation, MHC I vs MHC II, T-cell and B-cell activation",
  "Class switching, somatic hypermutation, cytokine functions, and antibody structure",
  "Hypersensitivity reactions I-IV with mechanism, timing, and tissue pattern",
  "Immunodeficiency disorders: SCID, DiGeorge, Bruton, CVID, Hyper-IgM, IgA deficiency",
  "Phagocyte and complement defects: CGD, LAD, Chediak-Higashi, C5-C9, C1 inhibitor",
  "Autoimmune disease mechanisms, tolerance failure, and antibody pattern recognition",
  "Transplant rejection, graft-versus-host disease, and immunosuppressant mechanisms",
  "HIV life cycle, diagnosis markers, opportunistic infections, and drug classes",
  "Vaccines, passive vs active immunity, and contraindications in immune compromise",
];

const STEP1_GENERAL_PATHOLOGY = [
  "Cell injury: reversible injury, irreversible injury, necrosis, apoptosis",
  "Acute inflammation mediators, neutrophil recruitment, and vascular changes",
  "Chronic inflammation, granulomas, wound healing, fibrosis, and repair",
  "Edema, hyperemia, congestion, thrombosis, embolism, infarction, and shock",
  "Neoplasia: tumor suppressors, oncogenes, metastasis, carcinogens, and tumor markers",
  "Paraneoplastic syndromes and cancer-associated laboratory patterns",
];

const STEP1_PHARM_PRINCIPLES = [
  "Receptors, agonists, partial agonists, antagonists, and signal transduction",
  "Competitive vs noncompetitive inhibition and potency vs efficacy curves",
  "Therapeutic index, loading dose, maintenance dose, clearance, and volume of distribution",
  "First-order vs zero-order elimination and steady-state reasoning",
  "Cytochrome P450 inducers, inhibitors, metabolism, and drug-drug interactions",
  "Adverse drug reactions, teratogens, contraindications, and antidote matching",
];

const STEP1_MICRO_BACTERIA = [
  "Staphylococci and streptococci disease patterns, toxins, and treatment choices",
  "Enterococci, Bacillus, Clostridia, Corynebacterium, and Listeria",
  "Neisseria, Haemophilus, Bordetella, Legionella, and respiratory gram-negatives",
  "Pseudomonas, enteric gram-negatives, Vibrio, Campylobacter, and Helicobacter pylori",
  "Chlamydia, Rickettsia, Mycoplasma, spirochetes, and mycobacteria",
  "Antibiotic mechanism, resistance mechanism, toxicity, and classic contraindication",
];

const STEP1_MICRO_NONBACTERIAL = [
  "Viruses by genome, envelope, replication site, latency, cancer association, and antiviral",
  "Fungi by yeast/mold/dimorphism, geography, immune status, morphology, and treatment",
  "Parasites by lifecycle, vector, geography, organ involvement, diagnostic form, and treatment",
];

const STEP1_RAPID_RECOGNITION = [
  "Murmur timing/radiation and pressure-volume loop changes",
  "MI wall-complication timeline and post-MI mechanical emergencies",
  "A-a gradient, V/Q mismatch, obstructive/restrictive PFTs, and oxygen dissociation shifts",
  "Nephritic vs nephrotic patterns, RTA I-IV, FeNa, and diuretic site/electrolyte effects",
  "Direct vs indirect bilirubin, hepatitis serologies, pancreatitis complications, IBD distinctions",
  "Primary vs secondary endocrine disease, DKA vs HHS, MEN syndromes, and adrenal axes",
  "Pregnancy hormones, placenta previa vs abruption, fetal circulation, and pharyngeal arch derivatives",
  "Stroke localization, brainstem crossed findings, spinal cord lesions, and visual field deficits",
  "Myasthenia vs Lambert-Eaton, Parkinson vs Huntington vs Wilson, and seizure drug toxicities",
  "Vasculitis vessel-size map, bullous disease skin level, and connective-tissue antibody patterns",
  "Microcytic anemia algorithm, hemolysis markers, leukemia morphology, and lymphoma translocations",
  "HIT vs TTP vs HUS vs DIC, transfusion reactions, chemo toxicities, and paraneoplastic syndromes",
];

const STEP1_SYSTEM_LEAF_TARGETS: Record<string, string[]> = {
  "Cardiovascular System Leaf Targets": [
    "Cardiac action potentials: nodal vs ventricular phases, ion currents, and antiarrhythmic class effects",
    "Pressure-volume loop: preload, afterload, contractility, valve lesions, and heart-failure shifts",
    "Murmur localization: timing, radiation, bedside maneuvers, and pressure response",
    "MI complication timeline: arrhythmia, pericarditis, free-wall rupture, papillary rupture, septal rupture, aneurysm, Dressler",
    "Shock physiology: cardiogenic, obstructive, distributive, and hypovolemic hemodynamic profiles",
    "Heart-failure pharmacology: mortality benefit, preload/afterload effects, toxicity, and contraindication",
    "Vasculitis vessel-size map with organ pattern, antibody association, and board-favorite vignette clue",
  ],
  "Respiratory System Leaf Targets": [
    "Lung volumes/capacities: obstructive vs restrictive PFT pattern and residual volume logic",
    "A-a gradient and hypoxemia mechanism: low FiO2, hypoventilation, diffusion, V/Q mismatch, shunt",
    "Oxygen dissociation curve: pH, CO2, temperature, 2,3-BPG, fetal hemoglobin, and carbon monoxide shifts",
    "Asthma/COPD drug hierarchy: rescue, controller, steroid, anticholinergic, leukotriene, and toxicity",
    "TB drug toxicity and resistance pattern: RIPE adverse effects, monitoring, and classic contraindications",
    "Lung cancer recognition: central/peripheral location, histology, paraneoplastic syndrome, and smoking link",
    "Sarcoidosis vs tuberculosis vs fungal pneumonia: granuloma type, geography, immune status, and test clue",
  ],
  "Renal / Acid-Base Leaf Targets": [
    "Nephron transport map: segment transporter, diuretic site, electrolyte effect, and acid-base effect",
    "Prerenal vs intrinsic vs postrenal AKI: BUN/Cr, FeNa, urine osmolality, casts, and ultrasound logic",
    "Nephritic syndrome object: hematuria, RBC casts, complement pattern, antibody, and timing",
    "Nephrotic syndrome object: proteinuria, edema, hyperlipidemia, microscopy, thrombosis, and infection risk",
    "Renal tubular acidosis I-IV: urine pH, potassium direction, stone risk, cause, and treatment",
    "Acid-base compensation: primary disorder, expected compensation, anion gap, delta-delta, and mixed process",
    "RAAS physiology and drug effects: renin, angiotensin II, aldosterone, ACEi/ARB, aliskiren, spironolactone",
  ],
  "Gastrointestinal / Hepatobiliary Leaf Targets": [
    "Bilirubin pathway: unconjugated vs conjugated pattern, urine bilirubin, urobilinogen, and obstruction clue",
    "Viral hepatitis serology: HAV, HBV, HCV markers, vaccine status, acute vs chronic interpretation",
    "IBD distinction: Crohn vs ulcerative colitis location, histology, complications, antibodies, and cancer risk",
    "Cirrhosis complication object: ascites, varices, SBP, encephalopathy, hepatorenal syndrome, HCC screening",
    "Pancreatitis complication timeline: hypocalcemia, pseudocyst, necrosis, ARDS, shock, and chronic insufficiency",
    "Gallstone location pattern: biliary colic, cholecystitis, choledocholithiasis, cholangitis, gallstone ileus",
    "Malabsorption object: celiac, pancreatic insufficiency, bile acid loss, bacterial overgrowth, and vitamin pattern",
  ],
  "Endocrine / Metabolism Leaf Targets": [
    "Pituitary axis localization: primary vs secondary vs tertiary disease with feedback hormone pattern",
    "Thyroid disease object: Graves, Hashimoto, thyroid storm, myxedema coma, nodules, and drug toxicity",
    "Diabetes object: type 1 vs type 2, DKA vs HHS, chronic complications, and medication mechanism/toxicity",
    "Adrenal steroid map: enzyme defect, hormone excess/deficit, blood pressure, potassium, and sex steroid pattern",
    "Calcium/PTH/vitamin D object: primary hyperparathyroid, FHH, malignancy, hypoparathyroid, CKD, and osteoporosis",
    "MEN syndrome object: gene, tumor set, inheritance, screening clue, and associated endocrine axis",
    "Refeeding and nutrition-metabolism object: phosphate drop, thiamine risk, insulin shift, and prevention",
  ],
  "Reproductive / Embryology Leaf Targets": [
    "Pregnancy hormone timeline: hCG, progesterone, estrogen, hPL, relaxin, and physiologic lab changes",
    "Placenta previa vs abruption vs vasa previa: bleeding quality, pain, fetal status, risk factors, and first test",
    "Ovarian tumor marker map: epithelial, germ-cell, sex-cord stromal, hormone clue, and age pattern",
    "Testicular tumor marker map: seminoma vs nonseminoma, AFP, beta-hCG, LDH, and age pattern",
    "Pharyngeal arch/pouch/cleft derivative object with nerve, muscle, artery, and syndrome association",
    "Germ layer/neural crest derivative object with congenital syndrome and classic vignette clue",
    "Sex development object: Turner, Klinefelter, androgen insensitivity, 5-alpha-reductase deficiency, and Kallmann",
  ],
  "Neuro / Special Senses Leaf Targets": [
    "Stroke localization object: artery territory, cortical sign, motor/sensory pattern, and visual-field deficit",
    "Brainstem crossed-finding object: cranial nerve nucleus plus contralateral tract sign",
    "Spinal cord syndrome object: dorsal column, spinothalamic, corticospinal, anterior cord, Brown-Sequard, syringomyelia",
    "Basal ganglia disease object: Parkinson, Huntington, Wilson, dystonia, drug-induced movement disorder",
    "Neuromuscular junction object: myasthenia gravis vs Lambert-Eaton vs botulism vs organophosphate",
    "Seizure medication toxicity object: drug mechanism, adverse effect, pregnancy risk, and monitoring",
    "Visual pathway lesion object: optic nerve, chiasm, tract, radiation, cortex, and pupillary reflex finding",
  ],
  "MSK / Rheum / Derm Leaf Targets": [
    "Arthritis object: RA, OA, gout, pseudogout, septic arthritis, reactive arthritis, and psoriatic arthritis distinctions",
    "SLE and connective-tissue antibody object: antibody, complement pattern, organ system, pregnancy, and drug association",
    "Vasculitis object: vessel size, immune mechanism, organ pattern, antibody, and treatment clue",
    "Bullous disease object: skin split level, immunofluorescence pattern, autoantigen, and mucosal involvement",
    "Bone tumor object: age, location, x-ray pattern, mutation/translocation, and classic association",
    "Muscle enzyme pattern: dystrophy, inflammatory myopathy, toxic myopathy, and neuromuscular mimic",
    "Derm rash morphology object: primary lesion, distribution, trigger, mucosal involvement, and emergency flag",
  ],
  "Heme / Oncology Leaf Targets": [
    "Microcytic anemia algorithm: iron studies, RDW, reticulocyte response, lead, thalassemia, sideroblastic anemia",
    "Hemolysis object: intravascular vs extravascular markers, Coombs result, smear clue, and trigger",
    "Leukemia object: age, cell lineage, smear, immunophenotype, translocation, and emergency complication",
    "Lymphoma object: Hodgkin vs non-Hodgkin, cell of origin, translocation, presentation, and EBV/HIV association",
    "Coagulation lab object: PT, PTT, bleeding time, platelet count, mixing study, and factor inhibitor logic",
    "HIT vs TTP vs HUS vs DIC object: platelet count, hemolysis, coag labs, renal/neuro pattern, and treatment",
    "Chemo toxicity object: drug class, cell-cycle phase, organ toxicity, antidote/protection, and secondary malignancy risk",
  ],
};

const STEP1_BIOSTATS_ETHICS_NUTRITION = [
  "Sensitivity, specificity, PPV, NPV, prevalence shifts, and screening-test interpretation",
  "Relative risk, odds ratio, ARR, RRR, NNT, NNH, confidence intervals, and p values",
  "Type I/II error, power, bias types, study designs, intention-to-treat, and Kaplan-Meier curves",
  "Capacity vs competence, consent, surrogate decisions, confidentiality, and mandatory reporting",
  "End-of-life care, medical errors, impaired colleagues, boundaries, minors, and research ethics",
  "Macronutrients, malnutrition, refeeding syndrome, enteral/parenteral nutrition, and obesity physiology",
  "Vitamin/mineral deficiencies, pregnancy nutrition, alcohol deficiencies, and bariatric complications",
];

const STEP1_TOPIC_DONE_CRITERIA = [
  "Explain normal physiology without notes",
  "Explain the pathologic disruption and pathogenesis",
  "Differentiate closest mimics and classic vignette traps",
  "Predict laboratory, imaging, pathology, and complication patterns",
  "Predict treatment mechanism, adverse effects, and contraindications",
  "Reach 70%+ on targeted questions before counting the topic as mastered",
  "Recall the topic across spaced Anki intervals",
  "Recognize the topic inside a mixed clinical vignette",
];

const STEP2_DECISION_TREE = [
  "ABCs and hemodynamic stabilization before diagnosis",
  "Immediate life-saving treatment when delay risks death or permanent harm",
  "Bedside confirmation when it changes immediate action",
  "Best initial diagnostic test vs gold-standard test selection",
  "Definitive treatment and intervention timing",
  "Disposition: home, clinic, admission, ICU, OR, L&D, psychiatric admission",
  "Prevention, counseling, follow-up interval, and return precautions",
];

const STEP2_DO_NOT_MISS = [
  "Aortic dissection",
  "STEMI/NSTEMI and unstable angina",
  "Pulmonary embolism and DVT",
  "Tension pneumothorax, massive hemothorax, and cardiac tamponade",
  "Septic shock and meningitis",
  "Subarachnoid hemorrhage, stroke, status epilepticus, and spinal epidural abscess",
  "Cauda equina syndrome and compartment syndrome",
  "Ectopic pregnancy, ovarian torsion, testicular torsion, severe preeclampsia/eclampsia",
  "Necrotizing fasciitis, mesenteric ischemia, GI perforation, and bowel ischemia",
  "Postpartum hemorrhage, postpartum endometritis, and fetal heart tracing emergencies",
  "Suicidal intent with plan, delirium, child abuse, elder abuse, and intimate partner violence",
];

const STEP2_ERROR_TYPES = [
  "Knowledge gap",
  "Recognition failure",
  "Differential diagnosis failure",
  "Test-selection failure",
  "Management failure",
  "Sequence/timing failure",
  "Screening/prevention failure",
  "Pharmacology failure",
  "Ethics/patient-safety failure",
  "Biostatistics failure",
  "Misread stem",
  "Changed correct answer",
  "Time-pressure failure",
  "Overthinking",
];

const STEP2_SPECIALTY_CONTENT: Record<string, string[]> = {
  "Internal Medicine Must-Master": [
    "ACS, heart failure, arrhythmias, valvular disease, endocarditis, tamponade, and dissection",
    "Asthma, COPD, pneumonia, PE, pneumothorax, ARDS, OSA, TB, and hemoptysis",
    "AKI, nephritic/nephrotic syndromes, dialysis indications, electrolytes, acid-base, and kidney stones",
    "GI bleed, pancreatitis, biliary disease, IBD, cirrhosis complications, viral hepatitis, and colon cancer",
    "DKA/HHS, thyroid storm, myxedema coma, adrenal insufficiency, hypercalcemia, SIADH/DI",
    "Anemias, thrombocytopenia, TTP/HUS/DIC/HIT, leukemias/lymphomas, myeloma, neutropenic fever",
  ],
  "Pediatrics Must-Master": [
    "Neonatal jaundice, sepsis, RDS, TTN, meconium aspiration, congenital heart disease, NEC",
    "Infant fever by age, meningitis, bronchiolitis, croup, epiglottitis, pneumonia, Kawasaki disease",
    "Developmental milestones, autism, ADHD, fragile X, Down syndrome, child abuse, failure to thrive",
    "Bilious vomiting, projectile vomiting, failure to pass meconium, bulging fontanelle, and regression",
  ],
  "OB/GYN Must-Master": [
    "Prenatal care, dating, screening, Rh incompatibility, GDM, hypertension, preeclampsia, HELLP",
    "Placenta previa, abruption, vasa previa, PPROM, preterm labor, chorioamnionitis, labor dystocia",
    "Postpartum hemorrhage 4 Ts, endometritis, depression/psychosis, and fetal heart tracing categories",
    "Ectopic pregnancy, ovarian torsion, PID/TOA, endometriosis, fibroids, PCOS, contraception, menopause",
  ],
  "Psychiatry Must-Master": [
    "MDD, bipolar disorder, schizophrenia, delirium, dementia, anxiety, OCD, PTSD, eating disorders",
    "Substance intoxication/withdrawal, suicide risk, capacity, involuntary admission, and safety planning",
    "Serotonin syndrome, NMS, anticholinergic toxicity, sympathomimetic toxicity, opioid overdose",
  ],
  "Surgery Must-Master": [
    "Primary survey, secondary survey, hemorrhagic shock, tension pneumothorax, tamponade, flail chest",
    "Appendicitis, cholecystitis, cholangitis, pancreatitis, obstruction, volvulus, mesenteric ischemia",
    "Post-op fever timing, atelectasis, pneumonia, DVT/PE, wound infection, leak, ileus, urinary retention",
    "Peritonitis, free air, unstable trauma bedside intervention, acute limb ischemia, compartment syndrome",
  ],
  "Family Medicine and Prevention Must-Master": [
    "Cancer screening by population, risk factor, test, interval, stop rule, and abnormal follow-up",
    "Vaccination, hypertension, diabetes screening, lipids, obesity, tobacco/alcohol counseling",
    "Osteoporosis, fall prevention, depression screening, IPV, STI/HIV prevention, contraception",
  ],
  "Neurology Must-Master": [
    "Ischemic stroke, hemorrhagic stroke, TIA, seizure/status epilepticus, meningitis, encephalitis",
    "Migraine, temporal arteritis, Parkinson disease, MS, MG, GBS, cord compression, cauda equina",
    "Bell palsy, trigeminal neuralgia, brain tumors, and subarachnoid hemorrhage",
  ],
  "Derm/Rheum/Ortho Must-Master": [
    "Cellulitis vs necrotizing fasciitis, SJS/TEN, drug eruptions, psoriasis, melanoma, zoster, scabies",
    "RA, OA, SLE, Sjogren, scleroderma, myositis, vasculitides, gout, pseudogout, septic arthritis",
    "Hip fracture, osteomyelitis, ACL/PCL/meniscus, rotator cuff, carpal tunnel, back-pain red flags",
  ],
};

const STEP2_ALWAYS_REVIEW = [
  "ACS, heart failure, arrhythmias, PE/DVT, pneumonia, asthma/COPD",
  "AKI, electrolytes, acid-base, GI bleed, cirrhosis, pancreatitis, cholangitis",
  "DKA/HHS, thyroid emergencies, stroke, seizure, meningitis, sepsis, antibiotics",
  "Cancer emergencies, preeclampsia, postpartum hemorrhage, ectopic pregnancy, fetal tracings",
  "Newborn jaundice, pediatric fever, croup/epiglottitis/bronchiolitis, suicide, delirium",
  "Substance withdrawal, trauma, acute abdomen, post-op complications, screening, vaccines",
  "Ethics, capacity, patient safety, biostatistics, and nutrition",
];

const STEP3_INDEPENDENT_PHYSICIAN_OBJECTS = [
  "Clinical setting triage: outpatient, emergency department, inpatient ward, ICU, labor/delivery, telephone, home care",
  "Stability screen: airway, breathing, circulation, mental status, sepsis, hemorrhage, ACS, stroke, obstetric/toxicologic/psychiatric emergency",
  "Time-horizon assignment: immediate intervention, minutes-to-hours, same day, within days, routine follow-up, longitudinal prevention",
  "Decision-type selection: diagnose, stabilize, test, treat, consult, admit, discharge, monitor, counsel, prevent, reassess",
  "Least-wrong next step audit: avoid overtesting, undertreating, premature definitive therapy, and missed lethal diagnosis",
  "Follow-through object: monitoring parameter, follow-up interval, recurrence prevention, medication reconciliation, referral, and patient education",
];

const STEP3_HIGH_YIELD_ALGORITHMS = [
  "ACS: aspirin/ECG/troponin sequence, reperfusion pathway, anticoagulation, contraindications, discharge prevention",
  "Stroke: glucose/CT first, thrombolysis or thrombectomy eligibility, blood-pressure rules, antithrombotic timing",
  "Sepsis: source recognition, cultures without delaying antibiotics, fluids, lactate, vasopressors, source control",
  "DKA/HHS: fluids, potassium gate before insulin, dextrose threshold, anion gap/osmolality closure, precipitant repair",
  "Hypertensive emergency: end-organ damage recognition, IV drug choice, rate of reduction, pregnancy/aortic dissection variants",
  "Pulmonary embolism: unstable thrombolysis/embolectomy path vs stable imaging/anticoagulation path",
  "GI bleed: resuscitation, variceal vs nonvariceal medication, transfusion decision, endoscopy timing, rebleed prevention",
  "AKI and hyperkalemia: prerenal/intrinsic/postrenal logic, ECG calcium first, shift/remove potassium, dialysis indications",
  "Thyroid storm, myxedema coma, adrenal crisis: recognition, empiric stabilization, steroid timing, trigger treatment",
  "Neutropenic fever and meningitis: immediate empiric antibiotics, isolation, diagnostic timing, and de-escalation logic",
  "OB emergencies: ectopic pregnancy, preeclampsia/eclampsia, postpartum hemorrhage, shoulder dystocia, fetal distress",
  "Psych/addiction emergencies: suicidality, mania, acute psychosis, alcohol withdrawal, opioid overdose, serotonin syndrome vs NMS",
];

const STEP3_CCS_OPENING_ORDER_OBJECTS = [
  "Stable outpatient CCS template: vitals, focused exam, targeted labs/imaging, medication reconciliation, counseling, follow-up",
  "Unstable emergency CCS template: vitals, pulse ox, cardiac monitor, IV access, oxygen, fluids, ECG, stat labs, NPO, admit/consult",
  "Chest pain CCS template: ECG, troponin trend, aspirin when indicated, cardiac monitoring, anticoagulation/cath decision, risk-factor counseling",
  "Dyspnea CCS template: pulse ox, oxygen/ventilation support, chest imaging, ECG, ABG/VBG when needed, bronchodilator/diuretic/antibiotic branch",
  "Sepsis CCS template: cultures if no delay, broad antibiotics, lactate, fluids, vasopressor escalation, source control, ICU threshold",
  "Altered mental status CCS template: glucose, oxygen, naloxone/thiamine where appropriate, tox screen, infection/electrolyte/stroke/seizure workup",
  "Pregnancy emergency CCS template: pregnancy status, fetal assessment when viable, Rh status, ultrasound, OB consult, magnesium/antihypertensive when indicated",
  "Pediatric fever CCS template: age-based toxic appearance pathway, cultures, urine testing, LP decision, empiric antibiotics, admission threshold",
  "Psychiatric emergency CCS template: safety precautions, suicide/homicide risk, capacity, intoxication/medical screen, involuntary hold criteria",
  "Inpatient deterioration CCS template: rapid reassessment, vitals trend, labs/imaging, escalation of care, medication complication review, consult timing",
];

const STEP3_CCS_ERROR_OBJECTS = [
  "Failure to stabilize before advancing time",
  "Wrong site of care: outpatient when ED/inpatient/ICU was required",
  "Delayed treatment after diagnostic certainty was already sufficient",
  "Inappropriate treatment or contraindicated medication order",
  "Missing pregnancy test before imaging/medication in reproductive-age patient",
  "Missing medication reconciliation in chronic disease or adverse drug event case",
  "Missing preventive counseling, vaccination, screening, or lifestyle intervention",
  "Missing follow-up appointment, monitoring parameter, or recurrence surveillance",
  "Over-ordering broad tests after a focused diagnosis was clear",
  "Under-ordering critical monitoring, cultures, ECG, imaging, or consultation",
  "Premature discharge without safety-net instructions or stability criteria",
  "Advancing time before treatment, reassessment, or monitoring response",
  "Failure to recognize complication after an intervention or disease progression",
];

const STEP3_PREVENTION_NUTRITION_OBJECTS = [
  "Cancer screening object: eligible population, start age, interval, stop rule, abnormal result follow-up",
  "Cardiovascular prevention object: ASCVD risk, statin intensity, blood pressure goal, smoking cessation, exercise prescription",
  "Diabetes prevention/control object: screening indication, A1c target context, renal/cardiac medication selection, monitoring",
  "Vaccination object: age/risk indication, contraindication, pregnancy/immunocompromise rule, catch-up logic",
  "Depression/suicide/IPV/substance screening object: who to screen, immediate safety action, referral, and follow-up",
  "Falls/osteoporosis object: DEXA indication, calcium/vitamin D, exercise, home safety, medication-risk review",
  "Nutrition counseling object: obesity, diabetes, cardiovascular disease, pregnancy, alcohol deficiency, refeeding, and bariatric complications",
];

const STEP3_BIOSTATS_EBM_OBJECTS = [
  "Diagnostic test interpretation: sensitivity, specificity, likelihood ratio, pretest probability, posttest probability",
  "Treatment effect interpretation: ARR, RRR, NNT, NNH, hazard ratio, confidence interval, and clinical significance",
  "Study design object: case-control, cohort, RCT, crossover, noninferiority, systematic review, meta-analysis",
  "Bias object: selection, recall, lead-time, length-time, attrition, publication, confounding, and effect modification",
  "Drug advertisement attack: patient population, endpoint, absolute effect, adverse events, funding, and unsupported claim",
  "Abstract attack: research question, methods, validity threat, result magnitude, limitation, and board-style conclusion",
];

const MCAT_FC1_DETAIL = [
  "Amino acid structure, charge, pKa behavior, peptide bonds, and protein hierarchy",
  "Enzyme kinetics, inhibition, catalytic strategies, and Michaelis-Menten graph shifts",
  "Carbohydrates, lipids, nucleotides, DNA/RNA structure, replication, transcription, translation",
  "Operons, gene regulation, epigenetics, recombinant DNA, PCR, gels, blotting, and CRISPR-level basics",
  "Glycolysis, gluconeogenesis, glycogen, PPP, TCA, ETC/OxPhos, fatty acids, ketones, amino-acid metabolism",
  "Pathway object: location, purpose, inputs, outputs, rate-limiting enzyme, regulation, disease/passage context",
];

const MCAT_FC2_3_DETAIL = [
  "Cell organelles, membranes, transport, signal transduction, cell cycle, mitosis, meiosis, apoptosis",
  "Tissues, nervous/endocrine/cardiovascular/respiratory/renal/digestive/immune/MSK/reproductive systems",
  "Homeostasis, feedback loops, thermoregulation, fluid balance, acid-base balance, and hormone signaling",
  "Sensory systems, motor control, nervous integration, immune response, reproduction, development",
  "Evolution, ecology, population genetics, Hardy-Weinberg assumptions, drift, gene flow, and selection",
];

const MCAT_CHEM_PHYS_DETAIL = [
  "Atomic structure, periodic trends, bonding, intermolecular forces, stoichiometry, gases, and solutions",
  "Acids/bases, buffers, equilibrium, thermodynamics, kinetics, electrochemistry, and redox",
  "Fluids, hydrostatics, hydrodynamics, circuits, electrostatics, magnetism, waves, sound, optics, light",
  "Nuclear chemistry, radioactivity, spectroscopy, chromatography, centrifugation, dialysis, electrophoresis",
  "Organic functional groups, stereochemistry, SN1/SN2/E1/E2, carbonyls, carboxylic derivatives, alcohols, amines",
];

const MCAT_PSYC_SOC_DETAIL = [
  "Sensation, perception, consciousness, learning, memory, cognition, language, motivation, emotion",
  "Personality, psychological disorders, stress, social cognition, attitudes, prejudice, discrimination",
  "Group behavior, culture, socialization, demographics, social structure, stratification, poverty",
  "Health disparities, healthcare systems, social determinants, population health, epidemiology, research methods",
  "Confusion cluster: proactive vs retroactive interference; negative reinforcement vs punishment",
  "Confusion cluster: fundamental attribution error vs actor-observer bias; facilitation vs loafing",
  "Confusion cluster: assimilation vs accommodation; prevalence vs incidence; reliability vs validity",
  "Confusion cluster: sensitivity vs specificity; relative risk vs odds ratio; confounding vs effect modification",
];

const MCAT_CARS_METHOD = [
  "Identify thesis and author attitude in one sentence",
  "Label each paragraph function without over-highlighting",
  "Separate claims, examples, concessions, assumptions, and competing viewpoints",
  "Predict the author's next move from passage structure",
  "Answer within passage boundaries before using outside knowledge",
  "Review missed questions with thesis, paragraph purpose, support line, attractive trap, and prevention rule",
];

const MCAT_CARS_QUESTION_TYPES = [
  "Main idea",
  "Author tone",
  "Function",
  "Inference",
  "Strengthen",
  "Weaken",
  "New information",
  "Application",
  "Analogy",
  "According to the passage",
  "Author would most likely agree",
  "Best supports / undermines",
];

const MCAT_CARS_WRONG_ANSWERS = [
  "Too extreme",
  "True but irrelevant",
  "Opposite of author view",
  "Outside the passage",
  "Half-right",
  "Wrong scope",
  "Wrong relationship",
  "Unsupported inference",
  "Distorted wording",
  "Familiar-language trap",
];

const MCAT_DATA_METHODS = [
  "Research question, hypothesis, independent variable, dependent variable, controls, and confounders",
  "Mediator, moderator, blinding, randomization, selection bias, recall bias, observer bias, attrition bias",
  "Cross-sectional, case-control, cohort, randomized trial, systematic review, and meta-analysis",
  "Correlation vs causation, internal validity, external validity, construct validity, reliability",
  "p values, confidence intervals, Type I/II errors, power, prevalence, incidence, sensitivity, specificity",
  "Figure/table translation: axes, units, trend, exception, experimental manipulation, and answer boundary",
];

const MCAT_MATH_TOOLKIT = [
  "Scientific notation, exponent rules, logarithms, half-life, ratios, proportions, and percent change",
  "Unit conversion, dimensional analysis, estimation, mental arithmetic, and significant figures",
  "Graph slopes, linear/semi-log/log-log graphs, area under curves, and scatterplots",
  "Probability, mean, median, mode, standard deviation, normal distribution, z-score, and error bars",
  "Equation object: variables, units, conceptual meaning, rearrangements, biological application, and trap",
];

const MCAT_QBANK_ERRORS = [
  "Content gap",
  "Equation gap",
  "Definition gap",
  "Passage misread",
  "Figure misread",
  "Graph misread",
  "Experimental design error",
  "Statistical reasoning error",
  "Timing error",
  "Careless arithmetic",
  "CARS scope error",
  "CARS inference error",
  "CARS tone error",
  "Changed answer incorrectly",
  "Panic / stamina failure",
];

const MCAT_BIO_ORGAN_SYSTEM_OBJECTS = [
  "Nervous system: neuron resting potential, action potential, synapse, sensory pathway, motor pathway, and endocrine link",
  "Endocrine system: hormone class, receptor location, feedback axis, target tissue, and graph response",
  "Cardiovascular system: cardiac cycle, pressure-flow-resistance, blood vessels, hemoglobin transport, and regulation",
  "Respiratory system: ventilation, diffusion, oxygen transport, CO2 transport, acid-base integration, and exercise response",
  "Renal system: filtration, reabsorption, secretion, osmoregulation, aldosterone/ADH effects, and acid-base compensation",
  "Digestive system: enzyme source, absorption site, accessory organ function, metabolic integration, and hormone regulation",
  "Immune system: innate/adaptive response, antigen presentation, antibody function, inflammation, and vaccination logic",
  "Musculoskeletal system: muscle contraction, bone remodeling, lever mechanics, calcium regulation, and energy demand",
  "Reproductive/developmental system: gametogenesis, fertilization, embryogenesis, hormones, and heredity passage context",
];

const MCAT_ORGANIC_REACTION_OBJECTS = [
  "SN1/SN2/E1/E2 decision: substrate, nucleophile/base, solvent, temperature, stereochemistry, and product",
  "Alkene/alkyne addition: Markovnikov, anti-Markovnikov, syn/anti, oxidation/reduction, and rearrangement risk",
  "Aromatic reaction object: electrophilic aromatic substitution director, activating/deactivating group, and product prediction",
  "Carbonyl reaction object: nucleophilic addition vs acyl substitution, leaving group quality, and acid/base condition",
  "Carboxylic acid derivative reactivity ladder: acyl chloride, anhydride, ester, amide, carboxylate, and reduction",
  "Alcohol/ether/epoxide object: oxidation level, substitution, protection/deprotection, ring opening, and stereochemical result",
  "Amine object: basicity, nucleophilicity, amide formation, imine/enamine logic, and biological relevance",
  "Spectroscopy object: IR functional group, NMR splitting/integration/shift, mass fragment, DBE, and final structure",
];

const MCAT_PSYCH_SOC_CONFUSION_OBJECTS = [
  "Proactive vs retroactive interference distinction table with stem wording and memory direction",
  "Negative reinforcement vs punishment distinction table with behavior direction and stimulus removal/addition",
  "Fundamental attribution error vs actor-observer bias distinction table with perspective and situational discounting",
  "Social facilitation vs social loafing distinction table with audience/group context and task difficulty",
  "Assimilation vs accommodation distinction table with schema change vs information fit",
  "Reliability vs validity distinction table with repeatability, accuracy, and experiment design clue",
  "Prevalence vs incidence distinction table with snapshot vs new cases over time",
  "Confounding vs effect modification distinction table with distortion vs subgroup-specific effect",
];

const MCAT_FULL_LENGTH_PROTOCOL = [
  "Before exam: sleep, wake time, food, caffeine, break plan, workspace, phone restriction, scratch-paper system",
  "During exam: section pacing, passage triage, flagging, guessing, move-on rules, and bad-passage reset",
  "After exam pass 1: section score, timing, accuracy, confidence, fatigue, and emotional state",
  "After exam pass 2: every missed, guessed, low-confidence correct, and too-slow question",
  "After exam pass 3: recurring clusters, content/reasoning/timing/stamina/confidence diagnosis, repair plan",
];

const PREMED_MODULES = [
  "Premed Command Center",
  "Degree Audit and Academic Map",
  "Prerequisite Intelligence Engine",
  "GPA, BCPM, and Academic Trajectory Tracker",
  "Major and Career Planning",
  "MCAT Readiness System",
  "Clinical Exposure Portfolio",
  "Nonclinical Service Portfolio",
  "Research and Scholarly Work Portfolio",
  "Leadership, Teaching, Employment, and Extracurricular Portfolio",
  "AAMC Competency Map",
  "Reflection and Narrative Vault",
  "Letters of Recommendation Manager",
  "Medical School Intelligence Database",
  "School List Builder and Fit Engine",
  "Application Systems Command Center",
  "Personal Statement and Writing Studio",
  "Secondary Application System",
  "Interview Preparation System",
  "Situational Judgment Test System",
  "Financial Planning and Fee Assistance Module",
  "Gap Year / Post-Bacc / SMP Strategy Engine",
  "International and Caribbean Pathways",
  "International and Caribbean Pathway Track",
  "Compliance, Documentation, and Verification Vault",
  "Risk Alerts and Recovery Plans",
  "Semester-by-Semester Roadmap",
  "Application-Year War Room",
];

const PREMED_COMMON_CORE = [
  "General Biology I/II with lab",
  "General Chemistry I/II with lab",
  "Organic Chemistry I/II with lab",
  "Physics I/II with lab",
  "Biochemistry",
  "English composition or writing-intensive coursework",
  "Mathematics and statistics",
  "Psychology and sociology",
  "Genetics, cell biology, molecular biology, microbiology, physiology, anatomy, immunology, neuroscience",
  "Public health, ethics, and patient-care language coursework where relevant",
];

const PREMED_CLINICAL_ROLES = [
  "Medical assistant",
  "EMT / paramedic",
  "CNA / patient care technician / nursing assistant",
  "Scribe",
  "Hospice volunteer",
  "Hospital or clinic volunteer",
  "Clinical research coordinator",
  "Phlebotomist",
  "Medical interpreter",
  "Free clinic volunteer",
  "Public-health clinical outreach",
  "Shadowing",
  "Telehealth experience",
  "Health-system administrative work",
];

const PREMED_SERVICE_DOMAINS = [
  "Food insecurity",
  "Homelessness",
  "Refugee or immigrant support",
  "Disability advocacy",
  "Underserved tutoring",
  "Prison reentry",
  "Domestic violence resources",
  "Crisis response",
  "Community health education",
  "Elder support",
  "Youth mentorship",
  "Rural outreach",
  "Disaster relief",
  "Community organizing",
];

const PREMED_RESEARCH_FIELDS = [
  "Principal investigator, institution, project title, and research question",
  "Methods, study design, data type, and contribution level",
  "Hours, duration, authorship position, poster/presentation status, and publication status",
  "Skills gained, challenges overcome, recommendation-letter potential, and competencies demonstrated",
  "Research fit classification: essential, strongly recommended, helpful, not central, mission-specific",
];

const PREMED_SCHOOL_FIELDS = [
  "Mission, population served, rural/urban focus, primary-care focus, research intensity, disparities emphasis",
  "Application service, required exams, PREview/Casper/other assessment, MCAT policy, and MCAT validity window",
  "Prerequisites, labs, online/community-college/AP/international coursework policy, and completion deadline",
  "Letters, secondaries, interview format, curriculum style, grading, rotations, dual degrees, match outcomes",
  "Source URL, source date, last audited date, confidence, and school-reported vs inferred status",
];

const PREMED_EVIDENCE_STRENGTH_OBJECTS = [
  "Longitudinality: start date, end date, weekly cadence, interruptions, sustained responsibility, and renewal plan",
  "Responsibility: passive observer, helper, independent role, project owner, trainer/mentor, or institutional contributor",
  "Patient/community proximity: indirect exposure, direct service, direct patient contact, continuity, and population served",
  "Reflection quality: specific encounter, lesson learned, changed behavior, humility, and future physician relevance",
  "Evidence artifact: verifier, contact, certificate, letter, poster, publication, schedule, photo/doc link, or supervisor note",
  "Competency coverage: exact AAMC competency, evidence sentence, strength rating, and missing competency gap",
  "Application use: activity entry, most meaningful candidate, personal statement thread, secondary essay theme, interview story",
  "Ethics check: privacy protected, no exaggerated hours, no invented patient story, and role boundaries documented",
];

const PREMED_ACADEMIC_ENGINE_OBJECTS = [
  "Course entity audit: department, number, title, credits, grade, term, lab, delivery mode, transfer status, repeat status",
  "Prerequisite classification: confirmed match, likely match, needs syllabus review, school-specific uncertainty, no match",
  "BCPM classification candidate: biology, chemistry, physics, math/statistics, behavioral science, or non-science rationale",
  "Academic risk alert: low prerequisite grade, repeated science course, withdrawal pattern, downward trend, delayed lab",
  "MCAT readiness gate: biology, general chemistry, organic chemistry, biochemistry, physics, psych/soc, statistics, CARS baseline",
  "Course-load warning: multiple labs, MCAT prep, clinical work, leadership, application writing, and personal constraints",
  "Academic recovery option: DIY post-bacc, formal post-bacc, SMP, gap-year repair, retake, explanation strategy",
];

const PREMED_APPLICATION_SYSTEM_OBJECTS = [
  "AMCAS workflow: coursework entry, transcript request, work/activities, three most meaningful, letters, school list, fee assistance",
  "AACOMAS workflow: coursework entry, experiences, achievements, osteopathic exposure, DO letter need, deposits, traffic deadlines",
  "TMDSAS workflow: Texas residency, essays, activity entries, planned activities, school ranking, Texas-specific deadlines",
  "OMSAS/Canadian workflow: ABS activities, verifiers, provincial eligibility, references, GPA formula, bilingual requirement",
  "International/Caribbean workflow: credential evaluation, visa, international coursework, accreditation, rotations, licensure implications",
  "Secondary essay matrix: prompt type, character limit, reusable theme, mission alignment, quality-control status, archive link",
  "Application-year weekly war-room: transcript, activities, personal statement, primary submission, secondaries, interview prep, finances",
];

const PREMED_INTERVIEW_OBJECTS = [
  "Traditional interview story: why medicine, failure, conflict, service, diversity, ethical dilemma, future contribution",
  "MMI station object: prompt type, stakeholders, ethical principle, communication plan, action, reflection, timing",
  "Panel/group/virtual interview object: role, audience, collaboration signal, concise answer, camera/setting, follow-up note",
  "School mission briefing: mission, curriculum, clinical sites, service programs, research fit, geographic context, questions to ask",
  "Mock interview log: date, format, evaluator, weak answer, filler-word pattern, timing, feedback, next drill",
  "Post-interview tracker: thank-you note, update letter, letter of intent, waitlist action, decision/deposit deadline",
];

const PREMED_DOCUMENTATION_VAULT_OBJECTS = [
  "Transcript vault: official, unofficial, request date, received date, school destination, and discrepancy note",
  "Course syllabus/documentation vault: AP/IB/A-level, transfer course, online lab, course description, and prerequisite proof",
  "Certification vault: BLS/CPR, EMT/CNA/phlebotomy, expiration, renewal reminder, and application relevance",
  "Experience verification vault: supervisor contact, hours confirmation, role description, artifact link, and privacy level",
  "Research output vault: poster PDF, abstract citation, manuscript status, preprint, grant/award, and authorship role",
  "Application archive: submitted primary PDFs, secondary essays, interview notes, acceptance/waitlist/rejection, deposit receipts",
];

const PREMED_RISK_ALERT_OBJECTS = [
  "Missing prerequisite alert: affected schools, deadline, course option, lab requirement, and eligibility consequence",
  "Insufficient clinical exposure alert: direct-contact level, longitudinality, patient proximity, and next role to secure",
  "Service orientation alert: community served, duration, responsibility, reciprocity, and resume-stacking risk",
  "Weak recommender alert: relationship depth, observation context, ask timing, packet status, and backup evaluator",
  "Late MCAT timing alert: content readiness, diagnostic status, score release, application submission, and retake risk",
  "School-list imbalance alert: mission mismatch, residency issue, too many reaches, cost risk, and ineligible schools",
  "Burnout/overstacking alert: labs, MCAT, work, leadership, application writing, sleep, and recovery plan",
];

const PREMED_WRITING_RED_FLAGS = [
  "Resume recitation",
  "Hero narrative or saviorism",
  "Overdramatization or unsupported claims",
  "Excessive trauma disclosure without strategic purpose",
  "Artificial sentimentality",
  "Medical-TV motivation",
  "Generic 'science and helping people' claim without evidence",
];

const DAT_BIOLOGY_CONTENT = [
  "Cell and molecular biology",
  "Genetics and heredity",
  "Evolution, ecology, and diversity of life",
  "Plants and photosynthesis",
  "Animal form and function",
  "Human anatomy and physiology systems",
  "Developmental biology and behavior",
];

const DAT_GENERAL_CHEMISTRY_CONTENT = [
  "Stoichiometry and chemical equations",
  "Atomic and molecular structure",
  "States of matter, gases, liquids, solids, and solutions",
  "Acids, bases, buffers, equilibrium, and solubility",
  "Thermodynamics, kinetics, electrochemistry, and redox",
  "Periodic trends, bonding, lab calculations, and data interpretation",
];

const DAT_ORGANIC_CONTENT = [
  "Bonding, resonance, acid-base, stereochemistry, and conformations",
  "Alkanes, alkenes, alkynes, aromaticity, and substitution/elimination mechanisms",
  "Alcohols, ethers, epoxides, aldehydes, ketones, carboxylic acids, derivatives, and amines",
  "Spectroscopy, separation, synthesis planning, and reaction-condition recognition",
];

const DAT_PAT_CONTENT = [
  "Keyholes",
  "Top-front-end",
  "Angle ranking",
  "Hole punching",
  "Cube counting",
  "Pattern folding",
];

const DAT_QR_CONTENT = [
  "Algebra, equations, inequalities, exponent notation, and absolute value",
  "Ratios, proportions, graphical analysis, and quantitative comparison",
  "Data analysis, interpretation, sufficiency, probability, and statistics",
];

const DAT_HUMAN_SYSTEM_OBJECTS = [
  "Cardiovascular system: heart anatomy, blood flow, cardiac cycle, vessels, blood components, and pressure regulation",
  "Respiratory system: airway anatomy, gas exchange, hemoglobin transport, ventilation mechanics, and acid-base link",
  "Digestive system: organ sequence, enzyme source, absorption site, accessory organs, and nutrient processing",
  "Renal/urinary system: nephron segment, filtration, reabsorption, secretion, osmoregulation, and waste excretion",
  "Nervous/sensory system: neuron signaling, CNS/PNS organization, reflexes, special senses, and endocrine interaction",
  "Endocrine system: hormone source, target, feedback loop, and homeostasis disturbance",
  "Immune/lymphatic system: innate/adaptive defenses, antibodies, inflammation, vaccination, and pathogen response",
  "Reproductive/developmental system: gametogenesis, fertilization, embryology, hormones, and inheritance connection",
];

const DAT_ORGO_REACTION_OBJECTS = [
  "Alkane/alkene/alkyne reaction recognition: reagent, product, regiochemistry, stereochemistry, and mechanism family",
  "Aromatic substitution object: directing group, activation/deactivation, ortho/para/meta product, and reaction condition",
  "Carbonyl reaction object: aldehyde/ketone addition, carboxylic acid derivative substitution, reduction, oxidation, and protection",
  "Alcohol/ether/epoxide reaction object: oxidation, substitution, dehydration, ring opening, and stereochemical outcome",
  "Amine reaction object: basicity, nucleophilicity, acylation, imine formation, and biologically relevant functional group",
  "Multistep synthesis object: starting material, target, retrosynthetic disconnection, reagent choice, and side reaction trap",
];

const DAT_PAT_DRILL_OBJECTS = [
  "Keyholes 15-item drill: silhouette mismatch, depth mismatch, rotation trap, and elimination reason",
  "Top-front-end 15-item drill: visible/hidden line conversion, object reconstruction, and line-count audit",
  "Angle ranking 15-item drill: smallest-angle pairs, visual comparison method, and over-measuring trap",
  "Hole punching 15-item drill: fold stack order, coordinate reflection, and final-grid verification",
  "Cube counting 15-item drill: exposed-face tally, hidden cube inference, and systematic counting order",
  "Pattern folding 15-item drill: face adjacency, opposite faces, orientation, and mirrored-option rejection",
];

const CASPER_RESPONSE_SYSTEM = [
  "Typed response timing: read scenario, identify stakeholders, choose action, explain tradeoffs",
  "Video response timing: answer directly, acknowledge uncertainty, protect safety, and close professionally",
  "Ethical dilemma scenario drill",
  "Conflict and communication scenario drill",
  "Equity, inclusion, and cultural humility scenario drill",
  "Professionalism, reliability, and accountability scenario drill",
  "Self-reflection, mistake, and growth scenario drill",
];

const CASPER_RUBRIC_OBJECTS = [
  "Stakeholder map: who is affected, what each person needs, and whose safety is time-sensitive",
  "Facts-unknown discipline: state what you would clarify before judging motive or assigning blame",
  "Immediate safety screen: harm, coercion, intoxication, discrimination, patient safety, or policy violation",
  "Empathy sentence: acknowledge emotion without excusing unsafe behavior",
  "Ethical principle selection: autonomy, beneficence, nonmaleficence, justice, confidentiality, honesty, accountability",
  "Action ladder: private conversation, support, policy check, supervisor escalation, documentation, follow-up",
  "Equity and bias check: power dynamic, cultural context, language barrier, disability, and structural constraint",
  "Reflection close: what you would learn, how you would repair trust, and how you would prevent recurrence",
];

const CASPER_SCENARIO_OBJECTS = [
  "Peer cheating or professionalism concern with friendship pressure",
  "Unequal group-work contribution with approaching deadline",
  "Confidential information overheard in a public setting",
  "Colleague appears impaired, intoxicated, exhausted, or unsafe",
  "Discriminatory comment toward patient, peer, coworker, or community member",
  "Resource allocation conflict with competing needs and incomplete information",
  "Mistake disclosure after causing inconvenience, harm, or loss of trust",
  "Patient or peer refuses recommended help because of fear, cost, culture, or mistrust",
  "Boundary issue involving gift, social media, romantic interest, or dual relationship",
  "Conflict between policy and compassion where escalation may be necessary",
];

const MCAT_AMINO_ACID_AND_PROTEIN_OBJECTS = [
  "Amino acid one-letter/three-letter code, side-chain class, charge state, and pKa decision",
  "Peptide bond formation, hydrolysis, N-terminus/C-terminus direction, and cleavage logic",
  "Primary, secondary, tertiary, and quaternary protein structure stabilizing forces",
  "Denaturation vs folding vs chaperone-assisted refolding passage interpretation",
  "Enzyme Michaelis-Menten curve: Km, Vmax, kcat, catalytic efficiency, and Lineweaver-Burk shifts",
  "Competitive, noncompetitive, uncompetitive, and mixed inhibition graph recognition",
];

const MCAT_METABOLIC_PATHWAY_OBJECTS = [
  "Glycolysis: cytosol, investment/payoff steps, rate-limiting enzyme, ATP/NADH yield",
  "Gluconeogenesis: bypass enzymes, fasting trigger, substrate sources, and energy cost",
  "Glycogen synthesis and glycogenolysis: hormonal regulation and branch/debranch enzymes",
  "Pentose phosphate pathway: NADPH purpose, ribose production, oxidative vs nonoxidative phases",
  "Pyruvate dehydrogenase and TCA cycle: mitochondrial location, regulated steps, NADH/FADH2 output",
  "Electron transport chain and oxidative phosphorylation: complexes, proton gradient, oxygen role",
  "Fatty acid synthesis vs beta-oxidation: cellular compartment, carrier molecules, and fed/fasting logic",
  "Ketone body synthesis/use: liver production, extrahepatic use, fasting/diabetes context",
  "Amino acid metabolism and urea cycle: nitrogen disposal, ammonia toxicity, and organ location",
];

const MCAT_LAB_METHOD_OBJECTS = [
  "PCR: primers, template, polymerase, cycles, amplification target, and contamination trap",
  "Gel electrophoresis: size/charge separation, band direction, ladder interpretation, and blot follow-up",
  "Southern, Northern, and Western blot: DNA vs RNA vs protein target and probe/antibody logic",
  "ELISA and immunoassay: antigen/antibody capture, signal intensity, and false-positive/negative trap",
  "Chromatography: stationary/mobile phase, polarity/affinity/size separation, and elution order",
  "Centrifugation: density/sedimentation separation and pellet vs supernatant interpretation",
  "Spectrophotometry and Beer-Lambert law: absorbance, concentration, path length, and standard curve",
  "SDS-PAGE vs native PAGE: denatured molecular weight vs preserved complex/charge behavior",
  "Cell culture or knockout experiment: control group, manipulation, outcome measure, and inference limit",
];

const MCAT_CHEM_PHYS_EQUATION_OBJECTS = [
  "Fluids: continuity equation A1v1 = A2v2 and Bernoulli pressure/velocity tradeoff",
  "Hydrostatics: P = rho g h and buoyant force = displaced-fluid weight",
  "Circuits: Ohm law, power equations, series/parallel resistance, and capacitance relationships",
  "Electrochemistry: Ecell, delta G = -nFE, Nernst logic, anode/cathode, oxidation/reduction",
  "Kinematics and dynamics: velocity, acceleration, Newton laws, work-energy, and impulse",
  "Waves and sound: v = f lambda, Doppler shift, intensity, decibels, and resonance",
  "Optics: lens/mirror equation, magnification, focal length sign, and image orientation",
  "Acid-base: Henderson-Hasselbalch, buffers, titration regions, and pH/pKa dominance",
  "Thermodynamics: delta G, delta H, delta S, spontaneity, equilibrium relation, and heat transfer",
  "Kinetics: rate law, reaction order, half-life patterns, activation energy, and catalyst effects",
];

const MCAT_PSYCH_SOC_OBJECTS = [
  "Learning: classical conditioning, operant conditioning, reinforcement schedules, extinction, and generalization",
  "Memory: encoding, storage, retrieval, working memory, long-term memory, interference, and amnesia patterns",
  "Cognition/language: heuristics, biases, problem solving, language acquisition, and decision traps",
  "Motivation/emotion: drives, arousal, stress response, theories of emotion, and appraisal",
  "Psychological disorders: mood, anxiety, psychotic, somatic, personality, neurodevelopmental, and substance categories",
  "Identity/self: self-concept, self-efficacy, locus of control, identity formation, and role strain",
  "Social processes: conformity, obedience, groupthink, social loafing, facilitation, and deindividuation",
  "Culture/socialization: norms, sanctions, assimilation, multiculturalism, ethnocentrism, and cultural relativism",
  "Demographics/stratification: demographic transition, fertility/mortality, mobility, poverty, and social class",
  "Health disparities: social determinants, access, stigma, medicalization, epidemiologic measures, and inequity mechanisms",
];

const MCAT_CARS_REVIEW_OBJECTS = [
  "Missed main-idea question: rewrite thesis and remove outside knowledge",
  "Missed tone question: quote attitude words and separate author from quoted viewpoint",
  "Missed function question: label paragraph job before reading answer choices",
  "Missed inference question: identify exact support sentence and reject unsupported extension",
  "Missed analogy/application question: map relationship structure before matching content",
  "Missed weaken/strengthen question: identify claim, evidence, assumption, and answer effect",
  "Timing failure passage: log time per passage, reread trigger, and decision to move on",
];

const DAT_BIOLOGY_LEAF_OBJECTS = [
  "Cell metabolism: photosynthesis, respiration, enzymology, ATP production, and thermodynamics",
  "Cellular processes: membrane transport, signal transduction, mitosis/meiosis, and cell cycle control",
  "Cell structure/function: organelles, biomolecules, microscopy, and experimental cell biology",
  "Diversity of life: viruses, archaea, eubacteria, fungi, protists, plants, and animals",
  "Human systems: integumentary, skeletal, muscular, circulatory, lymphatic/immune, digestive, respiratory, urinary",
  "Human systems: nervous/sensory, endocrine, reproductive, and integrated homeostasis",
  "Genetics: molecular, classical, human, chromosomal, gene expression, epigenetics, technology, and genomics",
  "Developmental mechanisms, embryology basics, and developmental gene regulation",
  "Evolution/ecology: natural selection, population genetics, speciation, animal behavior, and ecosystem ecology",
];

const DAT_GENERAL_CHEMISTRY_LEAF_OBJECTS = [
  "Stoichiometry: percent composition, empirical formula, balancing, moles, molar mass, density, and limiting reagent",
  "Gases: kinetic molecular theory, Dalton, Boyle, Charles, ideal gas law, and partial pressure",
  "Liquids/solids: intermolecular forces, phase changes, vapor pressure, polarity, and structure-property links",
  "Solutions: concentration units, dilution, colligative properties, solubility, and polarity matching",
  "Acids/bases: pH, pOH, Ka/Kb, strong vs weak, Bronsted-Lowry reactions, buffers, and titration logic",
  "Equilibrium: Le Chatelier, K expressions, precipitation, acid/base equilibrium, and calculation setup",
  "Thermodynamics/thermochemistry: Hess law, enthalpy, entropy, spontaneity, calorimetry, and heat transfer",
  "Kinetics: rate laws, reaction order, activation energy, catalyst effect, and half-life",
  "Redox/electrochemistry: oxidation numbers, balancing, galvanic/electrolytic cells, and electrochemical calculations",
  "Atomic/molecular structure: electron configuration, orbital types, Lewis structures, VSEPR, bond type, and subatomic particles",
  "Periodic properties: representative elements, transition elements, trends, and descriptive chemistry",
  "Nuclear reactions and laboratory: decay, binding energy, lab equipment, safety, error analysis, and data analysis",
];

const DAT_ORGANIC_CHEMISTRY_LEAF_OBJECTS = [
  "Bonding/resonance: formal charge, resonance contributors, aromaticity, and electron-flow stability",
  "Acid-base chemistry: pKa comparisons, conjugate stability, solvent effects, and reaction direction",
  "Stereochemistry: chirality, R/S, E/Z, enantiomers, diastereomers, meso compounds, and optical activity",
  "Substitution/elimination: SN1, SN2, E1, E2 mechanism conditions, substrate, nucleophile/base, and solvent",
  "Addition reactions: alkene/alkyne additions, regioselectivity, stereoselectivity, and rearrangement risk",
  "Carbonyl chemistry: aldehydes, ketones, carboxylic acids, derivatives, nucleophilic acyl substitution",
  "Alcohols, ethers, epoxides, amines, and aromatic reactions: recognition, reactivity, and product prediction",
  "Chemical synthesis: one-step, two-step, and multi-step route selection with protecting-group awareness",
  "Spectroscopy/structure evaluation: IR, NMR, mass spectrometry, formula/DBE, and structure confirmation",
  "Laboratory techniques: extraction, distillation, recrystallization, chromatography, TLC, and separation logic",
];

const DAT_PAT_LEAF_OBJECTS = [
  "Keyholes: eliminate by silhouette dimension, projection mismatch, and hidden-feature trap",
  "Top-front-end: convert views into 3D object and mark line-count mismatches",
  "Angle ranking: compare smallest visual difference without over-measuring",
  "Hole punching: fold sequence, punch coordinates, symmetry reflection, and final grid",
  "Cube counting: visible-face count by stack, hidden cube inference, and tally check",
  "Pattern folding: edge adjacency, impossible face contact, orientation, and mirrored-option trap",
];

const DAT_READING_LEAF_OBJECTS = [
  "Science passage main idea and paragraph role map",
  "Detail question: locate exact sentence and avoid memory-only answers",
  "Inference question: stay within passage evidence and reject outside biology knowledge",
  "Tone/purpose question: identify author claim versus cited study or opposing view",
  "Search-and-destroy timing log: passage map, question order, and reread trigger",
  "Three-passage stamina check: accuracy by passage position and fatigue pattern",
];

const DAT_QR_LEAF_OBJECTS = [
  "Algebra equations, inequalities, absolute value, and expression manipulation",
  "Exponents, roots, scientific notation, and logarithm-style estimation",
  "Ratios, proportions, rates, unit conversions, and percent change",
  "Graphical analysis: slope, intercept, trend, table interpretation, and extrapolation limit",
  "Probability, combinations/permutations, expected value, and basic statistics",
  "Data sufficiency: determine whether information is enough without fully solving",
  "Quantitative comparison: compare expressions using signs, bounds, and sample values",
];

const STEP2_MEDICINE_ALGORITHM_OBJECTS = [
  "Chest pain: ECG + troponin first, then STEMI cath vs NSTEMI medical/risk pathway",
  "Irregularly irregular rhythm: unstable AF gets synchronized cardioversion before rate control",
  "Dyspnea with edema: separate HF, PE, COPD, pneumonia, and renal failure before testing",
  "Tension pneumothorax: immediate decompression before confirmatory imaging",
  "Hyperkalemia with ECG changes: IV calcium before insulin/glucose shift and potassium removal",
  "Dialysis indications: refractory acidosis, electrolytes, intoxication, overload, or uremia",
  "Unstable GI bleed: two large-bore IVs, type/cross, resuscitation, targeted meds, endoscopy after stabilization",
  "DKA: fluids first, check potassium before insulin, add dextrose as glucose falls, close anion gap",
  "Neutropenic fever: immediate broad-spectrum antibiotics before waiting for culture results",
  "Cord compression: steroids plus urgent imaging/intervention",
];

const SHELF_OBJECTS: Record<string, { presentations: string[]; emergencies: string[]; algorithms: string[]; skills: string[] }> = {
  "Internal Medicine": {
    presentations: [
      "Chest pain: ACS vs PE vs dissection vs pericarditis vs noncardiac pain",
      "Dyspnea: HF vs COPD/asthma vs pneumonia vs PE vs anemia",
      "Edema: heart failure vs cirrhosis vs nephrotic syndrome vs venous disease",
      "Abdominal pain with liver/pancreas/biliary pattern recognition",
      "Anemia: microcytic, normocytic, macrocytic, hemolytic, and chronic disease workup",
      "Electrolyte abnormality: sodium, potassium, calcium, acid-base, and kidney failure",
    ],
    emergencies: [
      "STEMI/NSTEMI with unstable features",
      "Aortic dissection with tearing pain or pulse deficit",
      "Massive PE with hypotension or hypoxemia",
      "Sepsis/septic shock with source control need",
      "Hyperkalemia with ECG changes",
      "Neutropenic fever",
    ],
    algorithms: [
      "ACS sequence: ECG/troponin, antiplatelet/anticoagulation, reperfusion when indicated",
      "AF sequence: unstable cardioversion; stable rate/rhythm plus anticoagulation assessment",
      "GI bleed sequence: resuscitate, variceal vs nonvariceal meds, endoscopy timing",
      "DKA/HHS sequence: fluids, potassium, insulin, dextrose, gap/osmolality monitoring",
      "AKI sequence: prerenal vs intrinsic vs postrenal with urine indices and ultrasound logic",
    ],
    skills: ["Medication reconciliation", "Discharge follow-up interval selection", "Problem representation for rounds"],
  },
  Surgery: {
    presentations: [
      "Trauma patient: primary survey abnormality recognition",
      "Acute abdomen: appendicitis, cholecystitis, cholangitis, pancreatitis, obstruction, perforation",
      "Postoperative fever by day and likely source",
      "Breast mass: age-based imaging and biopsy pathway",
      "Vascular presentation: acute limb ischemia, AAA, PAD, DVT/PE",
    ],
    emergencies: [
      "Tension pneumothorax in trauma",
      "Cardiac tamponade after penetrating trauma",
      "Unstable abdominal trauma with hemorrhage",
      "Peritonitis or free air",
      "Compartment syndrome",
      "Bowel obstruction with ischemia or perforation signs",
    ],
    algorithms: [
      "ATLS primary survey: airway, breathing, circulation, disability, exposure",
      "Appendicitis pathway: pregnancy test when relevant, imaging choice, operative vs antibiotic decision",
      "Cholangitis pathway: fluids, antibiotics, urgent biliary drainage",
      "Post-op fever pathway: atelectasis, UTI, pneumonia, wound, DVT/PE, leak by timing",
      "Acute limb ischemia pathway: heparin, vascular imaging when stable, urgent revascularization",
    ],
    skills: ["Wound assessment", "Fluid/electrolyte replacement reasoning", "Pre-op risk and post-op complication counseling"],
  },
  Pediatrics: {
    presentations: [
      "Fever in infant by age group and toxicity",
      "Stridor: croup vs epiglottitis vs bacterial tracheitis",
      "Cyanotic newborn and ductal-dependent congenital heart disease",
      "Vomiting: pyloric stenosis vs malrotation/volvulus vs gastroenteritis",
      "Developmental delay or regression",
      "Failure to thrive and child abuse red flags",
    ],
    emergencies: [
      "Toxic-appearing neonate with possible sepsis",
      "Bilious vomiting in infant",
      "Petechiae with fever",
      "Bulging fontanelle or meningitis signs",
      "Inconsistent injury history suggesting abuse",
      "Respiratory distress with exhaustion or rising CO2",
    ],
    algorithms: [
      "Infant fever workup by age and appearance",
      "Stridor airway algorithm: croup treatment vs epiglottitis airway protection",
      "Cyanotic newborn: oxygen response and prostaglandin E1 decision",
      "Developmental milestone localization and next evaluation",
      "Vaccination catch-up and contraindication logic",
    ],
    skills: ["Growth chart interpretation", "Parent counseling with safety-net return precautions", "Age-adjusted normal vital sign recognition"],
  },
  "OB/GYN": {
    presentations: [
      "First-trimester bleeding: ectopic vs miscarriage vs normal pregnancy",
      "Third-trimester bleeding: placenta previa vs abruption vs vasa previa",
      "Hypertension in pregnancy: gestational HTN vs preeclampsia vs HELLP vs eclampsia",
      "Fetal heart tracing: early, variable, late, prolonged, and sinusoidal patterns",
      "Pelvic pain: ectopic, torsion, PID, TOA, endometriosis, fibroids",
      "Abnormal uterine bleeding and postmenopausal bleeding workup",
    ],
    emergencies: [
      "Ectopic pregnancy with instability",
      "Ovarian torsion",
      "Severe preeclampsia/eclampsia",
      "Postpartum hemorrhage",
      "Shoulder dystocia",
      "Late decelerations with persistent fetal compromise",
    ],
    algorithms: [
      "Pregnancy test first in reproductive-age pelvic pain or bleeding",
      "Preeclampsia severe features: magnesium, blood pressure control, delivery timing",
      "Postpartum hemorrhage 4 Ts: tone, trauma, tissue, thrombin",
      "Fetal tracing response: reposition, fluids, stop oxytocin, oxygen if appropriate, delivery escalation",
      "Cervical cancer screening and abnormal Pap follow-up",
    ],
    skills: ["Prenatal visit schedule", "Contraception contraindication matching", "Labor stage and fetal station interpretation"],
  },
  Psychiatry: {
    presentations: [
      "Depressed patient: MDD vs bipolar depression vs grief vs adjustment",
      "Psychosis: schizophrenia vs brief psychotic vs mood disorder with psychosis vs substance/medical cause",
      "Acute confusion: delirium vs dementia vs intoxication/withdrawal",
      "Anxiety: panic, GAD, OCD, PTSD, phobia, and somatic symptom patterns",
      "Eating disorder: anorexia, bulimia, binge eating, medical complications",
      "Substance use: intoxication, withdrawal, maintenance therapy, and harm reduction",
    ],
    emergencies: [
      "Suicidal ideation with plan, means, intent, or lack of supports",
      "Delirium from medical cause",
      "Mania with unsafe behavior",
      "Alcohol withdrawal seizure or delirium tremens",
      "NMS vs serotonin syndrome",
      "Opioid overdose with respiratory depression",
    ],
    algorithms: [
      "Suicide risk assessment: intent, plan, means, prior attempts, supports, immediate safety",
      "Capacity assessment: understanding, appreciation, reasoning, communication",
      "Agitation pathway: de-escalation, medical causes, medication choice, restraints last",
      "Withdrawal/toxidrome differentiation by vitals, pupils, reflexes, sweating, and temperature",
      "Medication adverse-effect matching for SSRIs, antipsychotics, lithium, valproate, stimulants",
    ],
    skills: ["Mental status exam", "Safety planning", "Involuntary admission criteria"],
  },
  "Family Medicine": {
    presentations: [
      "Hypertension initial evaluation and medication selection",
      "Diabetes screening, diagnosis, lifestyle counseling, and medication escalation",
      "Hyperlipidemia and ASCVD risk-based statin decision",
      "Low back pain red flags vs conservative management",
      "Well-child/adolescent/adult preventive visit priorities",
      "Geriatric falls, polypharmacy, cognition, and functional status",
    ],
    emergencies: [
      "Hypertensive emergency",
      "Suicidal intent discovered in primary care",
      "Intimate partner violence safety concern",
      "Child or elder abuse suspicion",
      "Severe asthma/COPD exacerbation in clinic",
    ],
    algorithms: [
      "Cancer screening: population, age, risk, test, interval, stop rule, abnormal follow-up",
      "Vaccination schedule and contraindications",
      "Smoking/alcohol counseling with pharmacotherapy options",
      "Depression screening positive: safety check, treatment selection, follow-up interval",
      "Contraception counseling by contraindication and patient preference",
    ],
    skills: ["Motivational interviewing", "Shared decision-making", "Longitudinal follow-up planning"],
  },
  Neurology: {
    presentations: [
      "Acute focal neurologic deficit: ischemic stroke vs hemorrhage vs mimic",
      "Headache: migraine, tension, cluster, temporal arteritis, SAH red flags",
      "Weakness: UMN vs LMN vs neuromuscular junction vs muscle",
      "Seizure vs syncope vs psychogenic nonepileptic event",
      "Demyelination vs neurodegeneration vs peripheral neuropathy",
    ],
    emergencies: [
      "Stroke within thrombolysis/thrombectomy window",
      "Subarachnoid hemorrhage",
      "Status epilepticus",
      "Meningitis/encephalitis",
      "Spinal cord compression",
      "Cauda equina syndrome",
    ],
    algorithms: [
      "Acute stroke: noncontrast CT, glucose, thrombolysis/thrombectomy eligibility, BP management",
      "Seizure: stabilize, glucose/electrolytes, benzodiazepine first, second-line antiseizure selection",
      "Headache red flags: imaging/LP/ESR pathway by presentation",
      "Back pain neurologic red flags: MRI and urgent intervention triggers",
      "Parkinson medication and adverse-effect decision points",
    ],
    skills: ["Neuro exam localization", "Cranial nerve pattern recognition", "Gait and coordination interpretation"],
  },
  "Emergency Medicine": {
    presentations: [
      "Shock: distributive, cardiogenic, obstructive, hypovolemic recognition",
      "Altered mental status: glucose, oxygenation, tox, infection, seizure, stroke",
      "Chest pain and dyspnea immediate risk stratification",
      "Trauma primary survey and unstable patient actions",
      "Poisoning/toxidrome by pupils, skin, vitals, mental status, and reflexes",
    ],
    emergencies: [
      "Airway compromise",
      "Cardiac arrest or unstable arrhythmia",
      "Sepsis with hypotension",
      "Anaphylaxis",
      "Opioid overdose",
      "Status epilepticus",
    ],
    algorithms: [
      "ABCDE stabilization sequence",
      "Sepsis bundle: cultures if no delay, antibiotics, fluids, vasopressor escalation",
      "Anaphylaxis: IM epinephrine first, airway monitoring, adjuncts after",
      "Overdose: naloxone, decontamination indications, antidote matching, observation",
      "Disposition: discharge vs observation vs admission vs ICU",
    ],
    skills: ["Triage acuity assignment", "Critical-result response", "Procedural consent under emergency exceptions"],
  },
  "Critical Care": {
    presentations: [
      "Septic shock with vasopressor need",
      "ARDS and ventilator oxygenation problem",
      "DKA/HHS in ICU-level illness",
      "GI bleed requiring transfusion/resuscitation",
      "Acute renal failure with dialysis indication",
    ],
    emergencies: [
      "Refractory hypoxemia",
      "Cardiac tamponade",
      "Massive PE",
      "Severe hyperkalemia",
      "Hemorrhagic shock",
    ],
    algorithms: [
      "Ventilator basics: oxygenation vs ventilation adjustment",
      "Vasopressor selection and MAP target reasoning",
      "Central line/invasive monitoring complication recognition",
      "Sedation, delirium, mobility, and ventilator liberation bundle",
      "Transfusion threshold and massive transfusion logic",
    ],
    skills: ["ABG interpretation", "Ventilator parameter interpretation", "ICU handoff synthesis"],
  },
};

// ===========================================================================
// LANES
// ===========================================================================
export const BLUEPRINT_LANES: BlueprintLane[] = [
  { id: "step1", mode: "usmle", label: "Step 1", sub: "Basic-science blueprint", blueprintId: "bp-step1" },
  { id: "step2", mode: "usmle", label: "Step 2 CK", sub: "Clinical reasoning blueprint", blueprintId: "bp-step2" },
  { id: "dedicated", mode: "usmle", label: "Dedicated", sub: "Planning + execution layer", blueprintId: "bp-dedicated" },
  { id: "shelf", mode: "usmle", label: "Shelf", sub: "Rotation subject exams", blueprintId: "bp-shelf-im" },
  { id: "step3", mode: "usmle", label: "Step 3", sub: "Independent practice + CCS", blueprintId: "bp-step3" },
  { id: "premed", mode: "prehealth", label: "Pre-Med", sub: "Applicant operating system", blueprintId: "bp-premed" },
  { id: "mcat", mode: "prehealth", label: "MCAT", sub: "AAMC spine + tools", blueprintId: "bp-mcat" },
  { id: "dat", mode: "prehealth", label: "DAT", sub: "Dental admission test", blueprintId: "bp-dat" },
  { id: "casper", mode: "prehealth", label: "CASPer", sub: "Situational judgment", blueprintId: "bp-casper" },
];

export const lanesForMode = (mode: BlueprintMode): BlueprintLane[] =>
  BLUEPRINT_LANES.filter((lane) => lane.mode === mode);

// ===========================================================================
// BLUEPRINTS
// ===========================================================================
export const BLUEPRINTS: BlueprintCatalogEntry[] = [
  // ---------------------------------------------------------------- STEP 1 ---
  {
    id: "bp-step1", laneId: "step1", title: "Step 1 Master Blueprint", short: "Step 1",
    summary: "System-based basic science from the official USMLE Step 1 content outline, run as a question-first operating system.",
    version: 4, source: SRC.usmleStep1,
    crossTags: ["organ-system", "discipline", "mechanism", "pathology", "pharmacology", "microbiology", "clinical-presentation", "question-error-type"],
    categories: [
      cat("Official 2026 Content Spine", "The 18-area USMLE integrated content outline; use this as the map, not as a lecture list.", [
        ...USMLE_CONTENT_AREAS.map((area) => n(area, "content", { priority: area.includes("Biostatistics") || area.includes("Social") ? "high" : "medium", source: SRC.usmleStep1, tags: ["official-outline", "content-area"] })),
      ]),
      cat("Foundational Science Reasoning", "Mechanisms that travel across every system.", [
        n("Foundational science concept application", "content", { priority: "high", source: SRC.usmleStep1, tags: ["competency", "mechanism"] }),
        n("Graphic/table/specimen interpretation", "task", { priority: "high", source: SRC.usmleStep1, tags: ["competency", "image", "data"] }),
        n("Gene/molecular/cellular principles", "content", { tags: ["mechanism"] }),
        n("Normal processes only when tied to disease or pathology", "tracker", { tags: ["mechanism", "pathology"] }),
      ]),
      cat("Organ Systems", "The spine of the exam — each system cross-tagged by discipline + mechanism.", [
        ...ORGAN_SYSTEMS.map((sys) => n(sys, "content", { source: SRC.usmleStep1, tags: ["organ-system"] })),
      ]),
      ...Object.entries(STEP1_SYSTEM_LEAF_TARGETS).map(([name, items]) =>
        cat(name, "Concrete organ-system objects from the God-file; each can be searched, tagged, retested, and linked to questions/errors.", [
          ...nodes(items, "content", ["organ-system", slug(name), "leaf"], SRC.godFile, "high"),
        ])),
      cat("Discipline Matrix", "The second axis: every system should be crossed with these disciplines where relevant.", [
        ...STEP1_DISCIPLINES.map((discipline) => n(discipline, "tracker", { source: SRC.usmleStep1, tags: ["discipline"] })),
      ]),
      cat("Competency Weighting", "Keep prep honest: most questions apply foundational science, but diagnosis and communication matter too.", [
        n("Foundational science application target: 60-70%", "metric", { priority: "high", source: SRC.usmleStep1, tags: ["competency", "weighting"] }),
        n("Diagnosis target: 20-25%", "metric", { source: SRC.usmleStep1, tags: ["competency", "diagnosis"] }),
        n("Communication/interpersonal target: 6-9%", "metric", { source: SRC.usmleStep1, tags: ["competency", "communication"] }),
        n("Practice-based learning target: 4-6%", "metric", { source: SRC.usmleStep1, tags: ["competency", "improvement"] }),
      ]),
      cat("Pathology", "Mechanisms of disease as the answer-driving layer.", [
        n("Cellular injury, inflammation, neoplasia", "content", { priority: "high", tags: ["pathology", "mechanism"] }),
        n("System-specific pathology cross-link", "tracker", { tags: ["pathology", "organ-system"] }),
      ]),
      cat("General Pathology Leaf Targets", "Concrete Pathoma 1-3 style objects; each should become questions, Anki, and error-log repair when missed.", [
        ...nodes(STEP1_GENERAL_PATHOLOGY, "content", ["pathology", "mechanism", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Pharmacology", "Mechanisms, toxicities, and interactions tied to systems.", [
        n("Drug mechanisms & class effects", "content", { priority: "high", tags: ["pharmacology", "mechanism"] }),
        n("Toxicities & antidotes", "content", { tags: ["pharmacology"] }),
      ]),
      cat("Pharmacology Principles Leaf Targets", "The exact pharmacology reasoning objects that support every drug table.", [
        ...nodes(STEP1_PHARM_PRINCIPLES, "content", ["pharmacology", "mechanism", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Microbiology", "Classification, virulence, and host-defense interactions.", [
        n("Bacteria / virus / fungi / parasite map", "content", { tags: ["microbiology"] }),
        n("Antimicrobial mechanisms & resistance", "content", { tags: ["microbiology", "pharmacology"] }),
      ]),
      cat("Bacterial Organism Leaf Targets", "Organisms tracked by gram status, shape, oxygen need, toxin, virulence factor, test, treatment, and complication.", [
        ...nodes(STEP1_MICRO_BACTERIA, "content", ["microbiology", "organism", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Virus / Fungi / Parasite Leaf Targets", "Non-bacterial pathogens tracked by classification, route, immune-status clue, diagnostic form, and treatment.", [
        ...nodes(STEP1_MICRO_NONBACTERIAL, "content", ["microbiology", "organism", "leaf"], SRC.godFile, "medium"),
      ]),
      cat("Immunology", "Defects, hypersensitivity, and immune mechanisms.", [
        n("Innate vs. adaptive + hypersensitivity", "content", { tags: ["mechanism"] }),
        n("Immunodeficiencies & autoimmunity", "content", { tags: ["pathology"] }),
      ]),
      cat("Immunology Leaf Targets", "Concrete immune mechanisms and diseases; no vague 'review immunology' bucket.", [
        ...nodes(STEP1_IMMUNOLOGY_CONTENT, "content", ["immunology", "mechanism", "leaf"], SRC.usmleStep1, "high"),
      ]),
      cat("Biochemistry and Genetics", "Metabolism checkpoints and inheritance logic.", [
        n("Metabolism checkpoints", "content", { tags: ["mechanism"] }),
        n("Genetics & inheritance patterns", "content", { tags: ["mechanism"] }),
        n("Enzyme deficiency pattern recognition", "tracker", { priority: "high", tags: ["biochemistry", "mechanism"] }),
        n("Molecular methods and inheritance error bank", "queue", { tags: ["genetics", "error-log"] }),
      ]),
      cat("Biochemistry / Genetics Leaf Targets", "Concrete molecular and metabolic objects that can be checked off with questions, recall, and errors.", [
        ...nodes(STEP1_BIOCHEM_MOLECULAR, "content", ["biochemistry", "genetics", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Behavioral Science, Ethics, Biostatistics", "The questions that punish vague reasoning.", [
        n("Study design & bias", "content", { tags: ["discipline"] }),
        n("Ethics, consent, capacity", "content", { tags: ["discipline"] }),
        n("Screening math & test characteristics", "task", { tags: ["discipline"] }),
        n("Communication and interpersonal mini-cases", "task", { source: SRC.usmleStep1, tags: ["communication"] }),
      ]),
      cat("Biostatistics / Ethics / Nutrition Leaf Targets", "Track the exact formulas, ethics rules, and nutrition objects that repeatedly appear in questions.", [
        ...nodes(STEP1_BIOSTATS_ETHICS_NUTRITION, "content", ["biostats", "ethics", "nutrition", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Rapid Recognition Targets", "High-speed clinical pattern objects; these are small enough to retest directly.", [
        ...nodes(STEP1_RAPID_RECOGNITION, "tracker", ["rapid-recognition", "mixed", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Topic Definition of Done", "A topic is not done because a video was watched; it is done when these mastery behaviors are demonstrated.", [
        ...nodes(STEP1_TOPIC_DONE_CRITERIA, "metric", ["definition-of-done", "mastery"], SRC.godFile, "high"),
      ]),
      qbankCategory(),
      ankiCategory(),
      errorLogCategory(),
      assessmentCategory(),
      dedicatedPlannerCategory(),
      testDayCategory(),
    ],
  },

  // ---------------------------------------------------------------- STEP 2 ---
  {
    id: "bp-step2", laneId: "step2", title: "Step 2 CK Master Blueprint", short: "Step 2 CK",
    summary: "Clinical reasoning by organ system, clinical task, and discipline — anchored to the official Step 2 CK outline and physician-task framework.",
    version: 4, source: SRC.usmleStep2,
    crossTags: ["organ-system", "clinical-task", "clinical-discipline", "acuity", "setting", "question-style", "error-type"],
    categories: [
      cat("Organ Systems", "Adult + special systems reasoned through tasks, not facts.", [
        ...ORGAN_SYSTEMS.slice(0, 14).map((sys) => n(sys, "content", { source: SRC.usmleStep2, tags: ["organ-system"] })),
      ]),
      cat("Clinical Tasks", "The physician-task spine of CK (the real answer axis).", [
        ...STEP2_CLINICAL_TASKS.map((task) => n(task, "content", { priority: task.includes("Diagnosis") || task.includes("management") || task.includes("stabilization") ? "high" : "medium", source: SRC.usmleStep2, tags: ["clinical-task"] })),
      ]),
      cat("Best-Next-Step Decision Tree", "The exact sequence a CK vignette is asking you to run before choosing an answer.", [
        ...nodes(STEP2_DECISION_TREE, "content", ["clinical-task", "sequence", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Do-Not-Miss Diagnosis Queue", "Emergency and safety-critical presentations that require immediate recognition and action.", [
        ...nodes(STEP2_DO_NOT_MISS, "queue", ["acuity", "do-not-miss", "leaf"], SRC.godFile, "high"),
      ]),
      cat("2026 CK Format and Pace", "Track practice in the post-May-7-2026 block structure when applicable.", [
        n("16 x 30-minute block pacing model", "planner", { priority: "high", source: SRC.usmleStep2, tags: ["format", "timing"] }),
        n("≤20 questions per 30-minute block timing drill", "task", { priority: "high", source: SRC.usmleStep2, tags: ["format", "questions"] }),
        n("55-minute minimum break budget", "planner", { source: SRC.usmleStep2, tags: ["format", "logistics"] }),
      ]),
      cat("Clinical Disciplines", "Carried forward from the core clerkships.", [
        n("Internal medicine carry-forward", "tracker", { priority: "high", tags: ["clinical-discipline"] }),
        n("Surgery carry-forward", "tracker", { tags: ["clinical-discipline"] }),
        n("Pediatrics carry-forward", "tracker", { tags: ["clinical-discipline"] }),
        n("OB/GYN carry-forward", "tracker", { tags: ["clinical-discipline"] }),
        n("Psychiatry carry-forward", "tracker", { tags: ["clinical-discipline"] }),
        n("Family medicine and ambulatory care carry-forward", "tracker", { tags: ["clinical-discipline"] }),
        n("Neurology carry-forward", "tracker", { tags: ["clinical-discipline"] }),
      ]),
      cat("Acute Care", "Unstable-patient logic and stabilization first.", [
        n("Initial stabilization & ABCs", "content", { priority: "high", tags: ["acuity"] }),
        n("Emergency next-step algorithms", "content", { tags: ["acuity"] }),
      ]),
      cat("Longitudinal Care", "Chronic disease control and follow-up timing.", [
        n("Chronic disease management cadence", "content", { tags: ["setting"] }),
      ]),
      cat("Prevention and Screening", "USPSTF-style screening and risk reduction.", [
        n("Age/risk-based screening map", "content", { tags: ["prevention"] }),
        n("Vaccination and travel/preventive counseling map", "content", { source: SRC.usmleStep2, tags: ["prevention", "counseling"] }),
      ]),
      cat("Ethics, Safety, Communication, Systems", "Systems-based practice and safety.", [
        n("Consent / capacity / confidentiality", "content", { tags: ["discipline"] }),
        n("Patient safety & quality improvement", "content", { tags: ["systems"] }),
        n("Legal/ethical/professionalism systems target: 10-15%", "metric", { priority: "high", source: SRC.usmleStep2, tags: ["weighting", "systems"] }),
        n("Communication failures and handoff error log", "tracker", { tags: ["systems", "error-log"] }),
      ]),
      cat("Nutrition and Lifestyle Medicine", "USMLE explicitly codes Nutrition across systems; do not leave it as trivia.", [
        n("Nutrition target: 15-20%", "metric", { priority: "high", source: SRC.usmleStep2, tags: ["nutrition", "weighting"] }),
        n("Dietary counseling in preventive care", "content", { source: SRC.usmleStep2, tags: ["nutrition", "prevention"] }),
        n("Disease-specific nutrition management", "tracker", { tags: ["nutrition", "management"] }),
      ]),
      cat("Biostatistics and Evidence", "Abstract interpretation under time pressure.", [
        n("Abstract & study interpretation drills", "task", { tags: ["discipline"] }),
      ]),
      ...Object.entries(STEP2_SPECIALTY_CONTENT).map(([name, items]) =>
        cat(name, "Specialty-specific content objects from the God-file; each should be tracked by diagnosis, next step, management, and trap.", [
          ...nodes(items, "content", ["clinical-discipline", slug(name), "leaf"], SRC.godFile, "high"),
        ])),
      cat("Medicine Algorithm Leaf Targets", "Specific clinical decisions that should be tracked as answer-sequence objects.", [
        ...nodes(STEP2_MEDICINE_ALGORITHM_OBJECTS, "tracker", ["clinical-task", "algorithm", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Step 2 Error Taxonomy", "Every missed question gets one exact failure type so remediation is specific.", [
        ...nodes(STEP2_ERROR_TYPES, "tracker", ["error-log", "taxonomy"], SRC.godFile, "high"),
      ]),
      cat("Weekly Always-Review List", "A compact recurring queue for the diagnoses and tasks that should never disappear from rotation prep.", [
        ...nodes(STEP2_ALWAYS_REVIEW, "queue", ["weekly-review", "carry-forward"], SRC.godFile, "high"),
      ]),
      qbankCategory(),
      errorLogCategory(),
      ankiCategory(),
      assessmentCategory("Assessments"),
      dedicatedPlannerCategory("Dedicated Engine"),
      cat("Clinical Skills and Feedback", "Translate rotation feedback into tested behavior.", [
        n("Feedback → one behavior experiment", "tracker", { tags: ["feedback"] }),
        n("Patient-presentation reps", "task", { tags: ["clinical-task"] }),
      ]),
      cat("Residency Evidence Vault", "Evidence that compounds toward the match.", [
        n("Rotation evaluations & notable cases", "evidence", { tags: ["residency"] }),
      ]),
    ],
  },

  // ------------------------------------------------------------- DEDICATED ---
  {
    id: "bp-dedicated", laneId: "dedicated", title: "Dedicated Engine", short: "Dedicated",
    summary: "A planning + execution layer that attaches to Step 1, Step 2, or Step 3 — diagnostic-driven, weakness-ranked, and recovery-safeguarded.",
    version: 3, source: SRC.godFile, crossTags: ["phase", "weakness", "assessment"],
    categories: [
      cat("Baseline & Weakness", "Start from evidence, not vibes.", [
        n("Baseline diagnostic", "assessment", { priority: "high", tags: ["phase"] }),
        n("Weakness ranking", "metric", { priority: "high", tags: ["weakness"] }),
        n("Resource selection (lock the toolset)", "task", { tags: ["phase"] }),
        n("Primary exam selection: Step 1 / Step 2 / Step 3", "planner", { priority: "high", tags: ["phase", "exam"] }),
        n("Constraint register: date, work, rotations, health, travel", "tracker", { tags: ["planner", "safeguard"] }),
      ]),
      cat("Daily Execution", "Timed blocks + repair, every day.", [
        n("Daily plan generator", "planner", { priority: "high", tags: ["phase"] }),
        n("Timed blocks", "task", { tags: ["questions"] }),
        n("Error repair queue", "queue", { priority: "high", tags: ["error-log"] }),
        n("Yesterday repair before new questions", "task", { priority: "high", tags: ["error-log", "spaced"] }),
        n("Anki ceiling and missed-fact conversion", "tracker", { tags: ["anki", "safeguard"] }),
      ]),
      cat("Daily Execution Leaf Targets", "Concrete actions a student can complete without wondering what dedicated work means.", [
        n("Complete due Anki before adding new cards", "task", { priority: "high", source: SRC.godFile, tags: ["anki", "daily"] }),
        n("Finish timed question block and review same day", "task", { priority: "high", source: SRC.godFile, tags: ["questions", "daily"] }),
        n("Classify every miss by error type", "tracker", { priority: "high", source: SRC.godFile, tags: ["error-log", "daily"] }),
        n("Build only repeat-miss or algorithm cards", "task", { source: SRC.godFile, tags: ["anki", "error-log"] }),
        n("Retest yesterday's repaired weakness before new content", "queue", { priority: "high", source: SRC.godFile, tags: ["spaced", "daily"] }),
      ]),
      cat("Assessment Cadence", "Spaced checkpoints that steer the plan.", [
        n("Assessment calendar", "planner", { tags: ["assessment"] }),
        n("Simulation phase", "planner", { tags: ["phase"] }),
        n("Taper phase", "planner", { tags: ["phase"] }),
        n("Assessment review debt tracker", "tracker", { priority: "high", tags: ["assessment", "review"] }),
        n("Readiness decision log", "evidence", { tags: ["assessment", "audit"] }),
      ]),
      cat("Recovery and Human Factors", "The plan must adapt to the user, not punish the user.", [
        n("Low-energy day fallback plan", "planner", { priority: "high", tags: ["wellness"] }),
        n("Illness / injury / emergency adjustment", "planner", { tags: ["wellness", "safeguard"] }),
        n("Burnout warning signal log", "metric", { tags: ["wellness", "analytics"] }),
      ]),
      cat("Safeguards & Logistics", "Protect the human running the plan.", [
        n("Sleep / recovery safeguards", "task", { priority: "high", tags: ["wellness"] }),
        n("Exam logistics", "task", { tags: ["logistics"] }),
      ]),
    ],
  },

  // ---------------------------------------------------------- SHELF (xN) ------
  ...shelfBlueprints(),

  // ---------------------------------------------------------------- STEP 3 ---
  {
    id: "bp-step3", laneId: "step3", title: "Step 3 Master Blueprint", short: "Step 3",
    summary: "Independent practice, advanced clinical medicine, and CCS as a first-class system — anchored to the official Step 3 outline.",
    version: 4, source: SRC.usmleStep3,
    crossTags: ["task", "setting", "acuity", "ccs", "error-type"],
    categories: [
      cat("Foundations of Independent Practice", "FIP day-one reasoning and systems.", [
        n("Biostatistics, abstracts, drug ads", "content", { priority: "high", tags: ["discipline"] }),
        n("Systems-based practice & safety", "content", { tags: ["systems"] }),
        n("Unsupervised generalist role framing", "content", { priority: "high", source: SRC.usmleStep3, tags: ["role"] }),
        n("Practice-based learning and improvement decisions", "tracker", { tags: ["systems", "improvement"] }),
      ]),
      cat("Advanced Clinical Medicine", "Multi-system management and prognosis.", [
        n("Outpatient + longitudinal management", "content", { tags: ["setting"] }),
        n("Preventive medicine & nutrition", "content", { tags: ["prevention"] }),
        n("Chronic disease medication adjustment queue", "queue", { tags: ["management", "longitudinal"] }),
        n("Prognosis and complication counseling", "content", { tags: ["management", "communication"] }),
      ]),
      cat("Sites of Care", "Step 3 questions start in a setting; management changes with the setting.", [
        ...STEP3_SITES_OF_CARE.map((site) => n(site, "content", { source: SRC.usmleStep3, tags: ["setting"] })),
      ]),
      cat("Independent Physician Algorithm Objects", "The Step 3 thinking loop: setting, stability, time horizon, decision type, and follow-through.", [
        ...nodes(STEP3_INDEPENDENT_PHYSICIAN_OBJECTS, "tracker", ["role", "clinical-task", "sequence", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Emergency & Acute Stabilization", "Triage, orders, monitoring.", [
        n("Initial orders & monitoring", "content", { priority: "high", tags: ["acuity"] }),
        n("ED triage and disposition decisions", "task", { priority: "high", source: SRC.usmleStep3, tags: ["acuity", "setting"] }),
        n("Consult, admit, transfer, or outpatient follow-up logic", "tracker", { tags: ["management", "setting"] }),
      ]),
      cat("High-Yield Management Algorithms", "Named Step 3 algorithms tracked by sequence, contraindication, monitoring, disposition, and follow-up.", [
        ...nodes(STEP3_HIGH_YIELD_ALGORITHMS, "tracker", ["management", "algorithm", "leaf"], SRC.godFile, "high"),
      ]),
      cat("CCS Mastery", "Computer-based case simulations — a first-class system.", [
        n("Opening-order templates", "content", { priority: "high", tags: ["ccs"] }),
        n("Site-of-care selection", "content", { tags: ["ccs"] }),
        n("Monitoring & reassessment", "content", { tags: ["ccs"] }),
        n("Consultation & follow-up", "content", { tags: ["ccs"] }),
        n("Clock-advancement discipline", "task", { priority: "high", tags: ["ccs"] }),
        n("CCS error taxonomy", "tracker", { tags: ["ccs", "error-type"] }),
        n("Preventive care and patient counseling orders", "task", { tags: ["ccs", "prevention"] }),
        n("Case closure and disposition checklist", "task", { tags: ["ccs", "logistics"] }),
      ]),
      cat("CCS Opening Order Objects", "Concrete templates that can be practiced and marked done case by case.", [
        ...nodes(STEP3_CCS_OPENING_ORDER_OBJECTS, "task", ["ccs", "opening-orders", "leaf"], SRC.godFile, "high"),
      ]),
      cat("CCS Error Taxonomy Objects", "Specific CCS failure modes; every case review should attach one when relevant.", [
        ...nodes(STEP3_CCS_ERROR_OBJECTS, "tracker", ["ccs", "error-type", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Step 3 Independent-Physician Decision Objects", "Step 3 is not Step 2 again; track management, prioritization, setting, and follow-up as separate skills.", [
        n("Longitudinal medication adjustment with monitoring interval", "tracker", { priority: "high", source: SRC.godFile, tags: ["management", "longitudinal"] }),
        n("Admit vs observe vs discharge with safety-net instructions", "tracker", { priority: "high", source: SRC.usmleStep3, tags: ["setting", "disposition"] }),
        n("Consult timing: urgent, routine, or after stabilization", "tracker", { source: SRC.godFile, tags: ["management", "sequence"] }),
        n("Preventive care bundle for chronic disease CCS cases", "task", { source: SRC.godFile, tags: ["ccs", "prevention"] }),
        n("CCS harmful-order avoidance list", "queue", { priority: "high", source: SRC.godFile, tags: ["ccs", "safety"] }),
      ]),
      cat("CCS Case Bank", "Reps across presentations and settings.", [
        n("Worked CCS case queue", "queue", { tags: ["ccs"] }),
        n("Ambulatory CCS reps", "queue", { tags: ["ccs", "setting"] }),
        n("Inpatient CCS reps", "queue", { tags: ["ccs", "setting"] }),
        n("Emergency CCS reps", "queue", { priority: "high", tags: ["ccs", "acuity"] }),
      ]),
      cat("Preventive Medicine / Nutrition Objects", "Prevention, nutrition, and counseling tracked as first-class Step 3 management work.", [
        ...nodes(STEP3_PREVENTION_NUTRITION_OBJECTS, "content", ["prevention", "nutrition", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Biostatistics / EBM / Drug-Ad Objects", "Day-1 style evidence interpretation objects with exact review targets.", [
        ...nodes(STEP3_BIOSTATS_EBM_OBJECTS, "content", ["biostats", "ebm", "drug-ad", "abstract", "leaf"], SRC.usmleStep3, "high"),
      ]),
      qbankCategory("QBank and Error Log"),
      errorLogCategory(),
      assessmentCategory("Assessments"),
      dedicatedPlannerCategory("Resident-Compatible Planner"),
      testDayCategory("Test-day logistics"),
    ],
  },

  // ----------------------------------------------------------------- MCAT ----
  {
    id: "bp-mcat", laneId: "mcat", title: "AAMC + Jack Westin Master Blueprint", short: "MCAT",
    summary: "AAMC foundational concepts + content categories as the governing spine; Jack Westin is a topic-navigation and early-practice tool, not the curriculum.",
    version: 5, source: SRC.aamcMcat,
    crossTags: ["section", "foundational-concept", "skill", "passage-type", "question-type"],
    categories: [
      cat("Chem/Phys", "Chemical & Physical Foundations of Biological Systems.", [
        n("General chemistry foundations", "content", { source: SRC.aamcMcat, tags: ["section:cp"] }),
        n("Physics foundations", "content", { tags: ["section:cp"] }),
        n("Organic chemistry foundations", "content", { tags: ["section:cp"] }),
        n("Biochemistry (Chem/Phys context)", "content", { tags: ["section:cp"] }),
      ]),
      cat("CARS", "Critical Analysis and Reasoning Skills — a daily habit.", [
        n("Daily timed CARS passage", "task", { priority: "high", tags: ["section:cars"] }),
        n("Wrong-answer autopsy", "task", { tags: ["section:cars", "error-type"] }),
      ]),
      cat("Bio/Biochem", "Biological & Biochemical Foundations of Living Systems.", [
        n("Biochemistry & molecular biology", "content", { tags: ["section:bb"] }),
        n("Cell & organ-system biology", "content", { tags: ["section:bb"] }),
      ]),
      cat("Psych/Soc", "Psychological, Social, and Biological Foundations of Behavior.", [
        n("Psychology foundations", "content", { tags: ["section:ps"] }),
        n("Sociology foundations", "content", { tags: ["section:ps"] }),
      ]),
      cat("Scientific Inquiry and Reasoning Skills", "The four AAMC SIRS skills.", [
        n("Knowledge of scientific concepts", "content", { tags: ["skill"] }),
        n("Scientific reasoning & evidence", "content", { tags: ["skill"] }),
        n("Reasoning about design & execution", "content", { tags: ["skill"] }),
        n("Data-based & statistical reasoning", "content", { tags: ["skill"] }),
      ]),
      cat("AAMC Foundational Concepts", "The official content framework; every content item should map back here.", [
        ...MCAT_FOUNDATIONAL_CONCEPTS.map((concept) => n(concept, "content", { source: SRC.aamcMcat, tags: ["foundational-concept"] })),
      ]),
      cat("AAMC / Jack Westin Topic Spine", "Detailed content-category objects for targeted review; Jack Westin is a navigation tool, not the governing source.", [
        ...MCAT_CONTENT_CATEGORIES.map((topic) => n(topic, "content", {
          source: topic.match(/5C|Jack/i) ? SRC.jackWestin : SRC.aamcMcat,
          tags: ["content-category", topic.match(/^1|^2|^3/) ? "section:bb" : topic.match(/^4|^5/) ? "section:cp" : "section:ps"],
          resourceLinks: [{ label: "AAMC MCAT outline", url: SRC.aamcMcat.url!, kind: "official" }],
        })),
      ]),
      cat("FC1 Biomolecules / Molecular Biology Leaf Targets", "Concrete MCAT B/B objects mapped to AAMC FC1 and passage testing.", [
        ...nodes(MCAT_FC1_DETAIL, "content", ["foundational-concept", "fc1", "section:bb", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Amino Acid / Protein Action Objects", "Small enough to test directly: charge, structure, kinetics, and graph interpretation.", [
        ...nodes(MCAT_AMINO_ACID_AND_PROTEIN_OBJECTS, "content", ["section:bb", "amino-acids", "protein", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Metabolic Pathway Action Objects", "Each pathway is tracked by location, purpose, inputs/outputs, regulation, and passage context.", [
        ...nodes(MCAT_METABOLIC_PATHWAY_OBJECTS, "content", ["section:bb", "metabolism", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("FC2-FC3 Cells / Organ Systems / Evolution Leaf Targets", "Concrete biology and physiology objects that should be learned through passage application.", [
        ...nodes(MCAT_FC2_3_DETAIL, "content", ["foundational-concept", "fc2", "fc3", "section:bb", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Biology Organ-System Action Objects", "Organ systems tracked by physiologic purpose, signal/input/output, experiment, graph, and passage context.", [
        ...nodes(MCAT_BIO_ORGAN_SYSTEM_OBJECTS, "content", ["section:bb", "organ-system", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("FC4-FC5 Chem/Phys Leaf Targets", "Chemistry and physics content objects tracked by equation, units, experiment, and biological application.", [
        ...nodes(MCAT_CHEM_PHYS_DETAIL, "content", ["foundational-concept", "fc4", "fc5", "section:cp", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Organic Chemistry Reaction Action Objects", "Reaction objects for product prediction, mechanism family, stereochemistry, and passage use.", [
        ...nodes(MCAT_ORGANIC_REACTION_OBJECTS, "content", ["section:cp", "organic-chemistry", "reaction", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("FC6-FC10 Psych/Soc Leaf Targets", "Psych/Soc definitions and confusion clusters tracked as vignette-ready concepts, not passive flashcard volume.", [
        ...nodes(MCAT_PSYC_SOC_DETAIL, "content", ["foundational-concept", "fc6-fc10", "section:ps", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Psych/Soc Vignette Objects", "Definitions only count when the student can apply them to a scenario and distinguish close terms.", [
        ...nodes(MCAT_PSYCH_SOC_OBJECTS, "content", ["section:ps", "vignette", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Psych/Soc Confusion Cluster Objects", "Close-term distinctions turned into explicit tables and scenario checks.", [
        ...nodes(MCAT_PSYCH_SOC_CONFUSION_OBJECTS, "tracker", ["section:ps", "confusion-cluster", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Passage Reasoning", "Passage strategy across science sections.", [
        n("Passage mapping reps", "task", { tags: ["passage-type"] }),
        n("Author claim → evidence → limitation drill", "task", { priority: "high", tags: ["passage-type", "skill"] }),
        n("Passage-only answer discipline", "task", { tags: ["passage-type", "cars"] }),
      ]),
      cat("CARS Passage Method", "The actual CARS workflow: what to identify, how to stay inside the passage, and how to review misses.", [
        ...nodes(MCAT_CARS_METHOD, "task", ["section:cars", "cars-method", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("CARS Question-Type System", "Each question type is a trainable object with its own trap pattern.", [
        ...nodes(MCAT_CARS_QUESTION_TYPES, "tracker", ["section:cars", "question-type"], SRC.aamcMcat, "high"),
      ]),
      cat("CARS Wrong-Answer Taxonomy", "Classify misses by trap type so CARS feedback becomes actionable.", [
        ...nodes(MCAT_CARS_WRONG_ANSWERS, "tracker", ["section:cars", "error-type"], SRC.godFile, "high"),
      ]),
      cat("CARS Miss Repair Objects", "Every CARS miss should route to a concrete repair behavior, not just more passages.", [
        ...nodes(MCAT_CARS_REVIEW_OBJECTS, "tracker", ["section:cars", "repair", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Data Interpretation", "Figures, tables, and experimental data.", [
        n("Graph/table interpretation drills", "task", { tags: ["skill"] }),
        n("Variable and control extraction", "task", { priority: "high", tags: ["skill", "research-methods"] }),
        n("Result exceeds data trap log", "tracker", { tags: ["skill", "error-type"] }),
      ]),
      cat("Data and Research Methods Leaf Targets", "The exact research-literacy objects to track from every science passage.", [
        ...nodes(MCAT_DATA_METHODS, "content", ["skill", "research-methods", "data", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Lab Methods Action Objects", "Lab methods tracked by principle, separation target, output, passage use, and common trap.", [
        ...nodes(MCAT_LAB_METHOD_OBJECTS, "content", ["lab-methods", "research-methods", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Experimental Design", "Independent/dependent variables, controls, validity.", [
        n("Experimental-design drills", "task", { tags: ["skill"] }),
        n("Study design flaw taxonomy", "tracker", { tags: ["research-methods", "error-type"] }),
      ]),
      cat("Equation Bank", "Pick two equations weekly until automatic.", [
        n("Equation mastery tracker", "tracker", { tags: ["section:cp"] }),
        n("Weekly two-equation derivation/use drill", "task", { priority: "high", tags: ["section:cp", "schedule"] }),
      ]),
      cat("Math / Equation Toolkit", "Equations are tracked by variable, unit, meaning, rearrangement, biological use, and trap.", [
        ...nodes(MCAT_MATH_TOOLKIT, "tracker", ["section:cp", "math", "equation"], SRC.godFile, "high"),
      ]),
      cat("Chem/Phys Equation Action Objects", "Named equations and physics/chemistry moves that can be drilled and retested.", [
        ...nodes(MCAT_CHEM_PHYS_EQUATION_OBJECTS, "tracker", ["section:cp", "equation", "leaf"], SRC.aamcMcat, "high"),
      ]),
      cat("Lab Methods", "Separations, spectroscopy, assays.", [
        n("Lab-technique reference + drills", "content", { tags: ["section:cp", "section:bb"] }),
      ]),
      cat("Psych/Soc Definitions", "Term confusion is the hidden score leak.", [
        n("Psych/Soc term deck", "queue", { tags: ["anki", "section:ps"] }),
      ]),
      cat("CARS Question-Type Engine", "Classify by question type, not vibes.", [
        n("Question-type classification tracker", "tracker", { tags: ["section:cars", "question-type"] }),
      ]),
      ankiCategory(),
      cat("Passage/QBank Center", "AAMC-first practice; tools as scaffolding.", [
        n("AAMC question packs", "task", { priority: "high", source: SRC.aamcMcat, tags: ["questions"] }),
        n("Jack Westin daily passage", "task", { source: SRC.jackWestin, tags: ["questions", "tool"], resourceLinks: [{ label: "Jack Westin", url: "https://jackwestin.com/", kind: "tool" }] }),
      ]),
      cat("MCAT QBank Error Taxonomy", "Every question-set miss becomes a repair object with a clear action.", [
        ...nodes(MCAT_QBANK_ERRORS, "tracker", ["questions", "error-type"], SRC.godFile, "high"),
      ]),
      cat("Full-Length Center", "Full-length evidence governs readiness.", [
        n("AAMC full-length schedule + score log", "assessment", { priority: "high", source: SRC.aamcMcat, tags: ["assessment"] }),
      ]),
      cat("Full-Length Review Protocol", "Full lengths are diagnostic instruments; this keeps review from becoming just a score check.", [
        ...nodes(MCAT_FULL_LENGTH_PROTOCOL, "task", ["assessment", "full-length", "review"], SRC.godFile, "high"),
      ]),
      errorLogCategory(),
      cat("Timeline Engine", "Phase the runway: content → practice → full-lengths.", [
        n("Phase plan + weekly schedule", "planner", { tags: ["planner"] }),
        n("Diagnostic → target date → full-length runway", "planner", { priority: "high", tags: ["planner", "assessment"] }),
        n("Sunday review / CARS / equation accessory day", "planner", { tags: ["planner", "cars", "section:cp"] }),
      ]),
    ],
  },

  // --------------------------------------------------------------- PRE-MED ---
  {
    id: "bp-premed", laneId: "premed", title: "Applicant Operating System", short: "Pre-Med",
    summary: "The full Pre-Med command center: academic map, prerequisites, experiences mapped to AAMC competencies, application cycle, and a longitudinal evidence vault.",
    version: 4, source: SRC.godFile,
    crossTags: ["competency", "evidence-strength", "requirement", "cycle-phase"],
    categories: [
      cat("Mission Control", "One screen: readiness, next-best actions, alerts.", [
        n("Readiness score + gap analysis", "metric", { priority: "high", source: SRC.godFile, tags: ["dashboard"] }),
        n("Next-best-action list", "task", { priority: "high", tags: ["dashboard"] }),
      ]),
      cat("Installable Pre-Med Modules", "The God-file module spine; each installed module should become its own navigable operating surface.", [
        ...nodes(PREMED_MODULES, "planner", ["premed-module", "install"], SRC.godFile, "high"),
      ]),
      cat("Academic Map", "Identity, pathway intent, term-by-term plan.", [
        n("Pathway intent (MD/DO/Texas/Canada/Caribbean/international/MD-PhD…)", "tracker", { tags: ["academic"] }),
        n("Term-by-term course plan", "planner", { tags: ["academic"] }),
      ]),
      cat("Degree Audit", "Separate degree, gen-ed, major, and prereqs.", [
        n("Transcript / DARS import (confirm before locking)", "task", { tags: ["academic"] }),
        n("Degree vs. prereq separation", "tracker", { priority: "high", tags: ["requirement"] }),
        n("GPA / science-GPA trend + recovery", "metric", { tags: ["academic"] }),
      ]),
      cat("Academic Engine Objects", "The concrete academic records and warning logic the Pre-Med lane should track.", [
        ...nodes(PREMED_ACADEMIC_ENGINE_OBJECTS, "tracker", ["academic", "requirement", "source-governance", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Medical School Prerequisites", "Per-school requirements with source + confidence.", [
        n("Prerequisite group map (bio/chem/orgo/physics/biochem/math/stats/writing/psych/soc…)", "tracker", { priority: "high", source: SRC.amcas, tags: ["requirement"] }),
        n("Per-school requirement status (required/recommended/unknown)", "tracker", { tags: ["requirement"] }),
        n("Online/AP/CC/international policy notes (source-cited)", "content", { tags: ["requirement", "policy"] }),
      ]),
      cat("Common Core Prerequisite Objects", "Coursework objects that must remain school-policy aware; these are not universal final truth.", [
        ...nodes(PREMED_COMMON_CORE, "tracker", ["requirement", "coursework"], SRC.godFile, "high"),
      ]),
      cat("MCAT Readiness", "Bridge to the MCAT lane.", [
        n("Readiness from coursework completion", "metric", { tags: ["mcat"] }),
      ]),
      cat("Experiences and AAMC Competencies", "Map every activity to the 17 competencies.", [
        n("Activity → competency mapping", "tracker", { priority: "high", source: SRC.aamcComp, tags: ["competency"] }),
        n("Competency evidence-strength score", "metric", { tags: ["competency", "evidence-strength"] }),
        ...AAMC_COMPETENCIES.map((competency) => n(competency, "evidence", { source: SRC.aamcComp, tags: ["competency", "evidence-strength"] })),
      ]),
      cat("Application Evidence Strength Objects", "The scoring inputs for serious pre-med experiences; hours alone should never dominate.", [
        ...nodes(PREMED_EVIDENCE_STRENGTH_OBJECTS, "metric", ["evidence-strength", "competency", "reflection", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Clinical Exposure", "Paid/volunteer, direct vs. indirect contact.", [
        n("Clinical hours + direct-contact tracker", "tracker", { tags: ["clinical"] }),
        n("Exposure → longitudinal commitment progression", "tracker", { priority: "high", tags: ["clinical", "progression"] }),
        n("Patient-facing maturity reflection", "evidence", { tags: ["clinical", "reflection"] }),
        n("Clinical responsibility and verification path", "tracker", { tags: ["clinical", "verification"] }),
      ]),
      cat("Clinical Role Classification Objects", "Concrete clinical roles; each entry should track direct contact, boundaries, population, supervisor, reflection, and verifier.", [
        ...nodes(PREMED_CLINICAL_ROLES, "tracker", ["clinical", "role"], SRC.godFile, "medium"),
        n("Classify as passive observation vs clinical exposure vs direct care vs admin vs shadowing vs patient research", "tracker", { priority: "high", source: SRC.godFile, tags: ["clinical", "classification"] }),
      ]),
      cat("Community Service and Advocacy", "Non-clinical service and populations served.", [
        n("Service hours + impact + reflection", "tracker", { tags: ["service"] }),
        n("Service impact narrative and population served", "evidence", { priority: "high", tags: ["service", "narrative"] }),
        n("Longitudinal service commitment milestone", "tracker", { tags: ["service", "progression"] }),
      ]),
      cat("Nonclinical Service Domain Objects", "Service tracked by community need, reciprocity, duration, responsibility, and reflective maturity.", [
        ...nodes(PREMED_SERVICE_DOMAINS, "tracker", ["service", "domain"], SRC.godFile, "medium"),
        n("Flag isolated resume-stacking service unless supported by sustained reflection and responsibility", "metric", { priority: "high", source: SRC.godFile, tags: ["service", "quality"] }),
      ]),
      cat("Research and Scholarly Work", "From literature review to publication.", [
        n("Research role + outputs tracker", "tracker", { tags: ["research"] }),
        ...RESEARCH_MILESTONES.map((milestone) => n(milestone, milestone.includes("Submission") || milestone.includes("presentation") || milestone.includes("Poster") ? "evidence" : "tracker", { priority: milestone.includes("publication") || milestone.includes("presentation") ? "high" : "medium", tags: ["research", "progression"] })),
      ]),
      cat("Research Project Data Objects", "Research is tracked by contribution and output, not just hours.", [
        ...nodes(PREMED_RESEARCH_FIELDS, "tracker", ["research", "evidence"], SRC.godFile, "high"),
      ]),
      cat("Leadership, Teaching, Employment", "Responsibility and sustained contribution.", [
        n("Leadership / teaching / employment tracker", "tracker", { tags: ["leadership"] }),
        n("Membership → responsibility → project ownership ladder", "tracker", { priority: "high", tags: ["leadership", "progression"] }),
        n("Mentorship / teaching evidence", "evidence", { tags: ["leadership", "teaching"] }),
        n("Measurable impact and sustained contribution", "metric", { tags: ["leadership", "impact"] }),
      ]),
      cat("Letters of Recommendation", "Evaluators, relationship quality, status.", [
        n("LOR tracker (evaluator, ask date, status, waiver)", "tracker", { tags: ["application"] }),
      ]),
      cat("Personal Narrative Vault", "Capture stories while they're still fresh.", [
        n("Story / hardship / growth vault", "evidence", { priority: "high", tags: ["narrative"] }),
      ]),
      cat("Writing Studio Red-Flag Filters", "Guardrails that keep essays specific, ethical, and evidence-backed.", [
        ...nodes(PREMED_WRITING_RED_FLAGS, "tracker", ["writing", "narrative", "quality"], SRC.godFile, "high"),
      ]),
      cat("School Discovery and Fit", "Build a list by fit, not prestige.", [
        n("School list with fit logic + reason per school", "tracker", { source: SRC.amcas, tags: ["application"] }),
      ]),
      cat("School Intelligence Data Fields", "Every policy-sensitive school field needs a source, date, and confidence state.", [
        ...nodes(PREMED_SCHOOL_FIELDS, "tracker", ["application", "school-list", "source-governance"], SRC.godFile, "high"),
      ]),
      cat("Application Cycle Center", "AMCAS/AACOMAS/TMDSAS plus international pathways.", [
        n("Primary application checklist", "task", { priority: "high", source: SRC.amcas, tags: ["cycle-phase"] }),
      ]),
      cat("Application System Objects", "Separate workflows for application services so the app does not flatten AMCAS/AACOMAS/TMDSAS/OMSAS into one checklist.", [
        ...nodes(PREMED_APPLICATION_SYSTEM_OBJECTS, "tracker", ["application", "cycle-phase", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Secondary Essay Lab", "Prompts, reuse strategy, drafts, status.", [
        n("Secondary tracker + reuse matrix", "tracker", { tags: ["cycle-phase"] }),
      ]),
      cat("Interview Prep", "Format-specific prep + reflection.", [
        n("Interview format prep + mock log", "task", { tags: ["cycle-phase"] }),
      ]),
      cat("Interview Preparation Objects", "Interview prep as a trackable skill system: stories, mission briefing, mocks, feedback, and follow-up.", [
        ...nodes(PREMED_INTERVIEW_OBJECTS, "tracker", ["interview", "cycle-phase", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Financial Planning", "Costs, fee assistance, aid.", [
        n("Cost + FAP/fee-assistance tracker", "tracker", { tags: ["cycle-phase"] }),
      ]),
      cat("Gap Year / Reapplication", "Strategy if applicable.", [
        n("Gap-year / reapplication plan", "planner", { tags: ["cycle-phase"] }),
      ]),
      cat("International and Caribbean Pathways", "Caribbean and international specifics.", [
        n("International pathway notes (source-cited)", "content", { tags: ["policy"] }),
      ]),
      cat("Wellness and Burnout Safeguards", "Protect the human running the cycle.", [
        n("Wellness + workload safeguards", "task", { tags: ["wellness"] }),
      ]),
      cat("Data Sources / Audit Trail", "Source, version date, confidence, change log.", [
        n("Source + audit-date trail", "tracker", { priority: "high", tags: ["policy", "audit"] }),
        n("School-specific policy uncertainty queue", "queue", { priority: "high", tags: ["policy", "audit"] }),
        n("Advisor/user confirmation required before marking verified", "task", { source: SRC.godFile, tags: ["audit", "verification"] }),
      ]),
      cat("Documentation Vault Objects", "The actual records that should be saved locally and linked back to applications, experiences, and requirements.", [
        ...nodes(PREMED_DOCUMENTATION_VAULT_OBJECTS, "evidence", ["vault", "documentation", "leaf"], SRC.godFile, "high"),
      ]),
      cat("Risk Alert and Recovery Objects", "Alerts that explain why a gap matters, what evidence triggered it, and what to do next.", [
        ...nodes(PREMED_RISK_ALERT_OBJECTS, "queue", ["risk", "recovery", "leaf"], SRC.godFile, "high"),
      ]),
    ],
  },

  // ----------------------------------------------------------------- DAT -----
  {
    id: "bp-dat", laneId: "dat", title: "DAT Master Blueprint", short: "DAT",
    summary: "Dental Admission Test architecture scaffolded against the official ADA DAT specifications; content populated from the official testing authority.",
    version: 5, source: SRC.dat,
    crossTags: ["section", "skill", "question-type"],
    categories: [
      cat("Survey of Natural Sciences — Biology", "Cell/molecular, systems, genetics, ecology, evolution.", [
        n("Biology content map (ADA outline)", "content", { source: SRC.dat, tags: ["section:bio"] }),
        n("Biology high-yield subtopic queue", "queue", { tags: ["section:bio", "questions"] }),
        ...nodes(DAT_BIOLOGY_CONTENT, "content", ["section:bio", "leaf"], SRC.dat, "high"),
        ...nodes(DAT_BIOLOGY_LEAF_OBJECTS, "content", ["section:bio", "official-subtopic", "leaf"], SRC.dat, "high"),
      ]),
      cat("DAT Human Systems Objects", "Human biology objects that can be drilled by system, function, and homeostasis relationship.", [
        ...nodes(DAT_HUMAN_SYSTEM_OBJECTS, "content", ["section:bio", "human-systems", "leaf"], SRC.dat, "high"),
      ]),
      cat("Survey of Natural Sciences — General Chemistry", "Stoichiometry, equilibrium, thermo, electrochem.", [
        n("Gen-chem content map (ADA outline)", "content", { source: SRC.dat, tags: ["section:gc"] }),
        n("Gen-chem calculation and setup drill", "task", { tags: ["section:gc", "quant"] }),
        ...nodes(DAT_GENERAL_CHEMISTRY_CONTENT, "content", ["section:gc", "leaf"], SRC.dat, "high"),
        ...nodes(DAT_GENERAL_CHEMISTRY_LEAF_OBJECTS, "content", ["section:gc", "official-subtopic", "leaf"], SRC.dat, "high"),
      ]),
      cat("Survey of Natural Sciences — Organic Chemistry", "Mechanisms, reactions, stereochemistry, lab.", [
        n("Orgo content map (ADA outline)", "content", { source: SRC.dat, tags: ["section:oc"] }),
        n("Reaction and stereochemistry error log", "tracker", { tags: ["section:oc", "error-type"] }),
        ...nodes(DAT_ORGANIC_CONTENT, "content", ["section:oc", "leaf"], SRC.dat, "high"),
        ...nodes(DAT_ORGANIC_CHEMISTRY_LEAF_OBJECTS, "content", ["section:oc", "official-subtopic", "leaf"], SRC.dat, "high"),
      ]),
      cat("DAT Organic Reaction Objects", "Reaction families tracked by reagent, product, mechanism, stereochemistry, and synthesis use.", [
        ...nodes(DAT_ORGO_REACTION_OBJECTS, "content", ["section:oc", "reaction", "leaf"], SRC.dat, "high"),
      ]),
      cat("Perceptual Ability Test", "Six PAT subsections.", [
        n("PAT subsection drills (keyholes, TFE, angles, hole punch, cube counting, pattern folding)", "task", { priority: "high", tags: ["section:pat"] }),
        n("PAT timing and miss-type analytics", "metric", { priority: "high", tags: ["section:pat", "analytics"] }),
        ...nodes(DAT_PAT_CONTENT, "task", ["section:pat", "leaf"], SRC.dat, "high"),
        ...nodes(DAT_PAT_LEAF_OBJECTS, "task", ["section:pat", "visual-skill", "leaf"], SRC.dat, "high"),
      ]),
      cat("DAT PAT Drill Objects", "Repeatable 15-item drill objects with a clear miss taxonomy for each PAT subsection.", [
        ...nodes(DAT_PAT_DRILL_OBJECTS, "task", ["section:pat", "drill", "leaf"], SRC.dat, "high"),
      ]),
      cat("Reading Comprehension", "Dense science passage reasoning.", [
        n("RC timed passages", "task", { tags: ["section:rc"] }),
        ...nodes(DAT_READING_LEAF_OBJECTS, "tracker", ["section:rc", "passage", "leaf"], SRC.dat, "high"),
      ]),
      cat("Quantitative Reasoning", "Math + applied word problems.", [
        n("QR drills + formula recall", "task", { tags: ["section:qr"] }),
        n("Applied math / probability / data sufficiency tracker", "tracker", { tags: ["section:qr", "question-type"] }),
        ...nodes(DAT_QR_CONTENT, "content", ["section:qr", "leaf"], SRC.dat, "high"),
        ...nodes(DAT_QR_LEAF_OBJECTS, "content", ["section:qr", "official-subtopic", "leaf"], SRC.dat, "high"),
      ]),
      cat("Question Bank", "Timed practice by section.", [n("Sectioned timed blocks", "task", { tags: ["questions"] })]),
      cat("PAT Drill Center", "High-rep perceptual training.", [n("Daily PAT reps", "task", { tags: ["section:pat"] })]),
      cat("Formula and Reaction Bank", "Equations + named reactions.", [n("Formula/reaction tracker", "tracker", { tags: ["section:gc", "section:oc"] })]),
      ankiCategory(),
      cat("Full-Length Center", "Official-style full-lengths.", [n("Full-length schedule + score log", "assessment", { tags: ["assessment"] })]),
      errorLogCategory(),
      cat("Timeline / Dedicated Planner", "Phase the DAT runway.", [n("Phase plan + schedule", "planner", { tags: ["planner"] })]),
    ],
  },

  // --------------------------------------------------------------- CASPer ----
  {
    id: "bp-casper", laneId: "casper", title: "Casper SJT Blueprint", short: "CASPer",
    summary: "Situational-judgment architecture scaffolded against the official Acuity Insights Casper format; rubric + scenario content populated from the official authority.",
    version: 4, source: SRC.casper,
    crossTags: ["competency", "response-type", "scenario-type"],
    categories: [
      cat("Situational Judgment Foundations", "How Casper is scored + what it measures.", [
        n("Casper format + scoring overview (official)", "content", { priority: "high", source: SRC.casper, tags: ["competency"] }),
        n("2 sections / 11 scenarios format check", "metric", { priority: "high", source: SRC.casper, tags: ["format"] }),
        n("Video vs typed response timing drill", "task", { source: SRC.casper, tags: ["format", "timing"] }),
      ]),
      cat("Ethical Reasoning", "Principled, balanced judgment.", [n("Ethics framework + drills", "task", { tags: ["competency"] })]),
      cat("Empathy and Professionalism", "Perspective-taking under pressure.", [n("Empathy/professionalism reps", "task", { tags: ["competency"] })]),
      cat("Conflict and Communication", "De-escalation and clarity.", [n("Conflict-response drills", "task", { tags: ["competency"] })]),
      cat("Equity and Cultural Humility", "Fairness and inclusion.", [n("Equity scenario drills", "task", { tags: ["competency"] })]),
      cat("Time-Pressure Response Drills", "Structure fast, write/speak clearly.", [n("Typed-response structure drills", "task", { priority: "high", source: SRC.casper, tags: ["response-type"] }), n("Video-response structure drills", "task", { source: SRC.casper, tags: ["response-type"] })]),
      cat("Scenario Response Leaf Targets", "Concrete Casper response drills by mode and scenario type.", [
        ...nodes(CASPER_RESPONSE_SYSTEM, "task", ["scenario-type", "response-type", "leaf"], SRC.casper, "high"),
      ]),
      cat("CASPer Rubric Objects", "The response anatomy that each typed/video answer should visibly satisfy.", [
        ...nodes(CASPER_RUBRIC_OBJECTS, "tracker", ["rubric", "competency", "leaf"], SRC.casper, "high"),
      ]),
      cat("CASPer Scenario Objects", "Concrete scenario families for deliberate SJT reps without pretending there is a single official answer key.", [
        ...nodes(CASPER_SCENARIO_OBJECTS, "task", ["scenario-type", "leaf"], SRC.casper, "high"),
      ]),
      cat("Scenario Bank", "Reps across scenario types.", [n("Scenario practice queue", "queue", { tags: ["scenario-type"] })]),
      cat("Feedback Rubric", "Self-score against official competencies.", [n("Rubric self-scoring tracker", "tracker", { tags: ["competency"] })]),
      cat("Error Patterns", "Your recurring response weaknesses.", [n("Error-pattern tracker", "tracker", { tags: ["error-type"] })]),
      cat("Timing Analytics", "Words/minute and completion rate.", [n("Timing analytics", "metric", { tags: ["analytics"] })]),
      cat("Mock Test Center", "Full-length simulated Casper.", [n("Mock Casper + review", "assessment", { tags: ["assessment"] })]),
    ],
  },
];

// 13 installable shelf containers, each with the required clinical sub-structure.
function shelfBlueprints(): BlueprintCatalogEntry[] {
  const shelves = [
    "Internal Medicine", "Surgery", "Pediatrics", "OB/GYN", "Psychiatry", "Family Medicine",
    "Neurology", "Emergency Medicine", "Ambulatory Care", "Geriatrics", "Critical Care",
    "Electives / Sub-I", "CCSE (Comprehensive Clinical Science)",
  ];
  return shelves.map((name) => {
    const content = shelfContent(name);
    return {
      id: `bp-shelf-${slug(name)}`,
      laneId: "shelf" as BlueprintLaneId,
      title: `${name} Shelf Blueprint`,
      short: name,
      summary: `${name} shelf prep — presentations, illness scripts, must-not-miss emergencies, and Step-2 carry-forward, anchored to the NBME clinical science outline.`,
      version: 4,
      source: SRC.nbmeShelf,
      crossTags: ["presentation", "discipline", "acuity", "setting", "error-type"],
      categories: [
        cat("Presentations", "The presentations this shelf actually tests.", [
          ...nodes(content.presentations, "content", ["presentation", "shelf-leaf"], SRC.godFile, "high"),
          n("Chief complaint → illness-script mapping for each presentation above", "tracker", { priority: "high", tags: ["presentation", "clinical-task"] }),
        ]),
        cat("Illness Scripts", "Disease scripts built from presentation, discriminating clues, test, treatment, and trap.", [
          ...nodes(content.presentations.map((item) => `Illness script: ${item}`), "tracker", ["presentation", "illness-script"], SRC.godFile, "high"),
        ]),
        cat("Must-Not-Miss Emergencies", "The diagnoses where the first safe action matters more than elegant workup.", [
          ...nodes(content.emergencies, "queue", ["acuity", "emergency", "shelf-leaf"], SRC.godFile, "high"),
        ]),
        cat("Management Algorithms", "Next-best-step pathways with sequence, contraindication, disposition, and follow-up.", [
          ...nodes(content.algorithms, "tracker", ["clinical-task", "algorithm", "shelf-leaf"], SRC.godFile, "high"),
        ]),
        cat("Patient Encounter Tracker", "Turn real patients into evidence.", [n("Encounter log (dx, task, feedback, learning point)", "evidence", { tags: ["clinical"] })]),
        cat("NBME / Clerkship Feedback", "Use score reports and rotation feedback to steer repair.", [
          n("Content-area score report review", "assessment", { source: SRC.nbmeShelf, tags: ["assessment", "analytics"] }),
          n("Rotation feedback → shelf behavior experiment", "tracker", { tags: ["feedback", "clinical"] }),
        ]),
        cat("Required Skills / Procedures", "Rotation skill checklist with concrete skills for this shelf.", [
          ...nodes(content.skills, "tracker", ["skills", "shelf-leaf"], SRC.godFile, "medium"),
        ]),
        qbankCategory("Question Queue"),
        ankiCategory(),
        assessmentCategory("Assessment Plan"),
        cat("Last-Two-Week Mode", "Compressed high-yield endgame.", [
          n("Final-2-weeks: redo emergency algorithms and bottom-three NBME categories", "planner", { priority: "high", source: SRC.godFile, tags: ["planner", "assessment"] }),
          n("Final-72-hours: review incorrects, screening/prevention, ethics, and must-not-miss queue", "task", { priority: "high", source: SRC.godFile, tags: ["planner", "error-log"] }),
        ]),
        cat("Shelf → Step 2 Carry-Forward", "Misses become Step 2 tags, not deletions.", [
          n("Carry-forward miss tagging by diagnosis + task type + source shelf", "tracker", { priority: "high", tags: ["error-type", "carry-forward"] }),
          n("Repeat-miss conversion to Anki only when the miss recurs or is algorithmic", "task", { source: SRC.godFile, tags: ["anki", "carry-forward"] }),
        ]),
      ],
    };
  });
}

function shelfContent(name: string): { presentations: string[]; emergencies: string[]; algorithms: string[]; skills: string[] } {
  if (SHELF_OBJECTS[name]) return SHELF_OBJECTS[name];
  if (name === "Ambulatory Care") return SHELF_OBJECTS["Family Medicine"];
  if (name === "Geriatrics") {
    return {
      presentations: [
        "Falls, frailty, gait instability, and orthostatic hypotension",
        "Delirium vs dementia vs depression",
        "Polypharmacy and adverse drug event recognition",
        "Urinary incontinence, pressure injury risk, malnutrition, and functional decline",
        "Goals of care, advance directives, and caregiver strain",
      ],
      emergencies: ["Delirium from infection/medication/metabolic cause", "Hip fracture after fall", "Elder abuse or neglect", "Medication toxicity"],
      algorithms: [
        "Falls evaluation: orthostatics, medication review, vision/feet, gait, home safety",
        "Delirium workup: infection, medication, hypoxia, metabolic, pain, urinary retention/constipation",
        "Polypharmacy deprescribing: indication, harm, duplication, anticholinergic/sedative burden",
        "Capacity and surrogate decision pathway",
      ],
      skills: ["Functional status assessment", "Medication reconciliation", "Goals-of-care conversation"],
    };
  }
  if (name === "CCSE (Comprehensive Clinical Science)") {
    return {
      presentations: [...STEP2_ALWAYS_REVIEW, "Mixed random NBME-style presentation triage by system and task"],
      emergencies: STEP2_DO_NOT_MISS,
      algorithms: STEP2_MEDICINE_ALGORITHM_OBJECTS,
      skills: ["Mixed-block timing", "Weakest-three content areas review", "Weakest-three physician tasks review"],
    };
  }
  return {
    presentations: [
      `${name}: top chief complaints mapped to diagnosis, next step, and management`,
      `${name}: common outpatient vs inpatient presentation distinction`,
      `${name}: prevention/screening/counseling presentation`,
    ],
    emergencies: [`${name}: must-not-miss emergency recognition queue`, `${name}: unstable patient first action queue`],
    algorithms: [`${name}: best next step sequence`, `${name}: test selection vs treatment selection sequence`, `${name}: disposition and follow-up sequence`],
    skills: [`${name}: presentation synthesis`, `${name}: feedback-to-action tracker`],
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const blueprintById = (id: string): BlueprintCatalogEntry | undefined =>
  BLUEPRINTS.find((bp) => bp.id === id);

export const blueprintsForLane = (laneId: BlueprintLaneId): BlueprintCatalogEntry[] =>
  BLUEPRINTS.filter((bp) => bp.laneId === laneId);
