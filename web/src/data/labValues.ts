// NBME Laboratory Reference Values — the table shown inside USMLE / NBME
// exams. Transcribed from the official NBME PDF (nbme.org/laboratory-values,
// 2026 edition). Keep in sync if NBME revises it.

export interface LabValue {
  name: string;
  range: string;
  si: string;
  /** Sub-heading within the section (e.g. "Electrolytes"). */
  group?: string;
}

export interface LabSection {
  id: "serum" | "abg" | "csf" | "hematologic" | "urine" | "bmi";
  title: string;
  /** Extra search words (abbreviations people actually type). */
  aliases: string;
  values: LabValue[];
}

export const LAB_VALUES_SOURCE = "NBME Laboratory Reference Values (2026)";

export const LAB_SECTIONS: LabSection[] = [
  {
    id: "serum",
    title: "Serum",
    aliases: "blood chemistry bmp cmp lfts plasma",
    values: [
      { group: "General chemistry", name: "Sodium (Na⁺)", range: "136–146 mEq/L", si: "136–146 mmol/L" },
      { group: "General chemistry", name: "Potassium (K⁺)", range: "3.5–5.0 mEq/L", si: "3.5–5.0 mmol/L" },
      { group: "General chemistry", name: "Chloride (Cl⁻)", range: "95–105 mEq/L", si: "95–105 mmol/L" },
      { group: "General chemistry", name: "Bicarbonate (HCO₃⁻)", range: "22–28 mEq/L", si: "22–28 mmol/L" },
      { group: "General chemistry", name: "Urea nitrogen", range: "7–18 mg/dL", si: "2.5–6.4 mmol/L" },
      { group: "General chemistry", name: "Creatinine", range: "0.6–1.2 mg/dL", si: "53–106 μmol/L" },
      { group: "General chemistry", name: "Glucose", range: "Fasting: 70–100 mg/dL; Random, non-fasting: <140 mg/dL", si: "3.8–5.6 mmol/L; <7.77 mmol/L" },
      { group: "General chemistry", name: "Calcium", range: "8.4–10.2 mg/dL", si: "2.1–2.6 mmol/L" },
      { group: "General chemistry", name: "Magnesium (Mg²⁺)", range: "1.5–2.0 mg/dL", si: "0.75–1.0 mmol/L" },
      { group: "General chemistry", name: "Phosphorus (inorganic)", range: "3.0–4.5 mg/dL", si: "1.0–1.5 mmol/L" },
      { group: "Hepatic", name: "Alanine aminotransferase (ALT)", range: "10–40 U/L", si: "10–40 U/L" },
      { group: "Hepatic", name: "Aspartate aminotransferase (AST)", range: "12–38 U/L", si: "12–38 U/L" },
      { group: "Hepatic", name: "Alkaline phosphatase", range: "25–100 U/L", si: "25–100 U/L" },
      { group: "Hepatic", name: "Bilirubin, total // direct", range: "0.1–1.0 mg/dL // 0.0–0.3 mg/dL", si: "2–17 μmol/L // 0–5 μmol/L" },
      { group: "Hepatic", name: "Proteins, total", range: "6.0–7.8 g/dL", si: "60–78 g/L" },
      { group: "Hepatic", name: "Albumin", range: "3.5–5.5 g/dL", si: "35–55 g/L" },
      { group: "Hepatic", name: "Globulin", range: "2.3–3.5 g/dL", si: "23–35 g/L" },
      { group: "Other, serum", name: "Amylase", range: "25–125 U/L", si: "25–125 U/L" },
      { group: "Other, serum", name: "Lipase", range: "13–60 U/L", si: "13–60 U/L" },
      { group: "Other, serum", name: "Creatinine clearance", range: "Male: 97–137 mL/min; Female: 88–128 mL/min", si: "97–137 mL/min; 88–128 mL/min" },
      { group: "Other, serum", name: "Creatine kinase", range: "Male: 25–90 U/L; Female: 10–70 U/L", si: "25–90 U/L; 10–70 U/L" },
      { group: "Other, serum", name: "Lactate dehydrogenase", range: "45–200 U/L", si: "45–200 U/L" },
      { group: "Other, serum", name: "Osmolality", range: "275–295 mOsmol/kg H₂O", si: "275–295 mOsmol/kg H₂O" },
      { group: "Other, serum", name: "Troponin I", range: "≤0.04 ng/mL", si: "≤0.04 µg/L" },
      { group: "Other, serum", name: "Uric acid", range: "3.0–8.2 mg/dL", si: "0.18–0.48 mmol/L" },
      { group: "Lipids", name: "Cholesterol, total", range: "Normal: <200 mg/dL; High: >240 mg/dL", si: "<5.2 mmol/L; >6.2 mmol/L" },
      { group: "Lipids", name: "Cholesterol, HDL", range: "40–60 mg/dL", si: "1.0–1.6 mmol/L" },
      { group: "Lipids", name: "Cholesterol, LDL", range: "<160 mg/dL", si: "<4.2 mmol/L" },
      { group: "Lipids", name: "Triglycerides", range: "Normal: <150 mg/dL; Borderline: 151–199 mg/dL", si: "<1.70 mmol/L; 1.71–2.25 mmol/L" },
      { group: "Iron studies", name: "Ferritin", range: "Male: 20–250 ng/mL; Female: 10–120 ng/mL", si: "20–250 μg/L; 10–120 μg/L" },
      { group: "Iron studies", name: "Iron", range: "Male: 65–175 µg/dL; Female: 50–170 μg/dL", si: "11.6–31.3 μmol/L; 9.0–30.4 μmol/L" },
      { group: "Iron studies", name: "Total iron-binding capacity", range: "250–400 µg/dL", si: "44.8–71.6 μmol/L" },
      { group: "Iron studies", name: "Transferrin", range: "200–360 mg/dL", si: "2.0–3.6 g/L" },
      { group: "Endocrine", name: "Follicle-stimulating hormone", range: "Male: 4–25 mIU/mL; Female: premenopause 4–30 mIU/mL, midcycle peak 10–90 mIU/mL, postmenopause 40–250 mIU/mL", si: "4–25 IU/L; 4–30 IU/L; 10–90 IU/L; 40–250 IU/L" },
      { group: "Endocrine", name: "Luteinizing hormone", range: "Male: 6–23 mIU/mL; Female: follicular phase 5–30 mIU/mL, midcycle 75–150 mIU/mL, postmenopause 30–200 mIU/mL", si: "6–23 IU/L; 5–30 IU/L; 75–150 IU/L; 30–200 IU/L" },
      { group: "Endocrine", name: "Growth hormone – arginine stimulation", range: "Fasting: <5 ng/mL; Provocative stimuli: >7 ng/mL", si: "<5 μg/L; >7 μg/L" },
      { group: "Endocrine", name: "Prolactin (hPRL)", range: "Male: <17 ng/mL; Female: <25 ng/mL", si: "<17 μg/L; <25 μg/L" },
      { group: "Endocrine", name: "Cortisol", range: "0800 h: 5–23 μg/dL; 1600 h: 3–15 μg/dL; 2000 h: <50% of 0800 h", si: "138–635 nmol/L; 82–413 nmol/L; fraction of 0800 h: <0.50" },
      { group: "Endocrine", name: "TSH", range: "0.4–4.0 μU/mL", si: "0.4–4.0 mIU/L" },
      { group: "Endocrine", name: "Triiodothyronine (T₃) (RIA)", range: "100–200 ng/dL", si: "1.5–3.1 nmol/L" },
      { group: "Endocrine", name: "Triiodothyronine (T₃) resin uptake", range: "25%–35%", si: "0.25–0.35" },
      { group: "Endocrine", name: "Thyroxine (T₄)", range: "5–12 μg/dL", si: "64–155 nmol/L" },
      { group: "Endocrine", name: "Free T₄", range: "0.9–1.7 ng/dL", si: "12.0–21.9 pmol/L" },
      { group: "Endocrine", name: "Thyroidal iodine (¹²³I) uptake", range: "8%–30% of administered dose/24 h", si: "0.08–0.30/24 h" },
      { group: "Endocrine", name: "Intact PTH", range: "10–60 pg/mL", si: "10–60 ng/L" },
      { group: "Endocrine", name: "17-Hydroxycorticosteroids", range: "Male: 3.0–10.0 mg/24 h; Female: 2.0–8.0 mg/24 h", si: "8.2–27.6 μmol/24 h; 5.5–22.0 μmol/24 h" },
      { group: "Endocrine", name: "17-Ketosteroids, total", range: "Male: 8–20 mg/24 h; Female: 6–15 mg/24 h", si: "28–70 μmol/24 h; 21–52 μmol/24 h" },
      { group: "Immunoglobulins", name: "IgA", range: "76–390 mg/dL", si: "0.76–3.90 g/L" },
      { group: "Immunoglobulins", name: "IgE", range: "0–380 IU/mL", si: "0–380 kIU/L" },
      { group: "Immunoglobulins", name: "IgG", range: "650–1500 mg/dL", si: "6.5–15.0 g/L" },
      { group: "Immunoglobulins", name: "IgM", range: "50–300 mg/dL", si: "0.5–3.0 g/L" },
    ],
  },
  {
    id: "abg",
    title: "Arterial blood gases",
    aliases: "abg gas room air",
    values: [
      { name: "Po₂", range: "75–105 mm Hg", si: "10.0–14.0 kPa" },
      { name: "Pco₂", range: "33–45 mm Hg", si: "4.4–5.9 kPa" },
      { name: "pH", range: "7.35–7.45", si: "[H⁺] 36–44 nmol/L" },
    ],
  },
  {
    id: "csf",
    title: "Cerebrospinal fluid",
    aliases: "csf lumbar puncture lp",
    values: [
      { name: "Cell count", range: "0–5/mm³", si: "0–5 × 10⁶/L" },
      { name: "Chloride", range: "118–132 mEq/L", si: "118–132 mmol/L" },
      { name: "Gamma globulin", range: "3%–12% total proteins", si: "0.03–0.12" },
      { name: "Glucose", range: "40–70 mg/dL", si: "2.2–3.9 mmol/L" },
      { name: "Pressure", range: "70–180 mm H₂O", si: "70–180 mm H₂O" },
      { name: "Proteins, total", range: "<40 mg/dL", si: "<0.40 g/L" },
    ],
  },
  {
    id: "hematologic",
    title: "Blood",
    aliases: "hematologic hematology cbc heme coagulation coags",
    values: [
      { group: "Complete blood count", name: "Hematocrit", range: "Male: 41%–53%; Female: 36%–46%", si: "0.41–0.53; 0.36–0.46" },
      { group: "Complete blood count", name: "Hemoglobin, blood", range: "Male: 13.5–17.5 g/dL; Female: 12.0–16.0 g/dL", si: "135–175 g/L; 120–160 g/L" },
      { group: "Complete blood count", name: "Mean corpuscular hemoglobin (MCH)", range: "25–35 pg/cell", si: "0.39–0.54 fmol/cell" },
      { group: "Complete blood count", name: "Mean corpuscular hemoglobin concentration (MCHC)", range: "31%–36% Hb/cell", si: "4.8–5.6 mmol Hb/L" },
      { group: "Complete blood count", name: "Mean corpuscular volume (MCV)", range: "80–100 μm³", si: "80–100 fL" },
      { group: "Complete blood count", name: "Plasma volume", range: "Male: 25–43 mL/kg; Female: 28–45 mL/kg", si: "0.025–0.043 L/kg; 0.028–0.045 L/kg" },
      { group: "Complete blood count", name: "Red cell volume", range: "Male: 20–36 mL/kg; Female: 19–31 mL/kg", si: "0.020–0.036 L/kg; 0.019–0.031 L/kg" },
      { group: "Complete blood count", name: "Leukocyte count (WBC)", range: "4500–11,000/mm³", si: "4.5–11.0 × 10⁹/L" },
      { group: "Complete blood count", name: "Neutrophils, segmented", range: "54%–62%", si: "0.54–0.62" },
      { group: "Complete blood count", name: "Neutrophils, bands", range: "3%–5%", si: "0.03–0.05" },
      { group: "Complete blood count", name: "Lymphocytes", range: "25%–33%", si: "0.25–0.33" },
      { group: "Complete blood count", name: "Monocytes", range: "3%–7%", si: "0.03–0.07" },
      { group: "Complete blood count", name: "Eosinophils", range: "1%–3%", si: "0.01–0.03" },
      { group: "Complete blood count", name: "Basophils", range: "0%–0.75%", si: "0.00–0.0075" },
      { group: "Complete blood count", name: "Platelet count", range: "150,000–400,000/mm³", si: "150–400 × 10⁹/L" },
      { group: "Coagulation", name: "Partial thromboplastin time (PTT/aPTT) (activated)", range: "25–40 seconds", si: "25–40 seconds" },
      { group: "Coagulation", name: "Prothrombin time (PT)", range: "11–15 seconds", si: "11–15 seconds" },
      { group: "Coagulation", name: "D-dimer", range: "≤250 ng/mL", si: "≤1.4 nmol/L" },
      { group: "Other, hematologic", name: "Reticulocyte count", range: "0.5%–1.5%", si: "0.005–0.015" },
      { group: "Other, hematologic", name: "Erythrocyte count (RBC)", range: "Male: 4.3–5.9 million/mm³; Female: 3.5–5.5 million/mm³", si: "4.3–5.9 × 10¹²/L; 3.5–5.5 × 10¹²/L" },
      { group: "Other, hematologic", name: "Erythrocyte sedimentation rate (Westergren)", range: "Male: 0–15 mm/h; Female: 0–20 mm/h", si: "0–15 mm/h; 0–20 mm/h" },
      { group: "Other, hematologic", name: "CD4⁺ T-lymphocyte count", range: "≥500/mm³", si: "≥0.5 × 10⁹/L" },
      { group: "Endocrine", name: "Hemoglobin A1c", range: "≤6%", si: "≤42 mmol/mol" },
    ],
  },
  {
    id: "urine",
    title: "Urine",
    aliases: "urinalysis ua 24-hour",
    values: [
      { name: "Calcium", range: "100–300 mg/24 h", si: "2.5–7.5 mmol/24 h" },
      { name: "Osmolality", range: "50–1200 mOsmol/kg H₂O", si: "50–1200 mOsmol/kg H₂O" },
      { name: "Oxalate", range: "8–40 μg/mL", si: "90–445 μmol/L" },
      { name: "Proteins, total", range: "<150 mg/24 h", si: "<0.15 g/24 h" },
    ],
  },
  {
    id: "bmi",
    title: "BMI",
    aliases: "body mass index weight",
    values: [{ name: "Body mass index (BMI)", range: "Adult: 19–25 kg/m²", si: "Adult: 19–25 kg/m²" }],
  },
];

/** Case- and accent-insensitive search across names, groups and ranges. */
export function searchLabValues(query: string): Array<LabValue & { section: LabSection["title"] }> {
  const fold = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[⁰-⁹₀-₉⁺⁻]/g, (char) => SUPER_SUB[char] ?? char).toLowerCase();
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return LAB_SECTIONS.flatMap((section) => section.values
    .filter((value) => {
      const hay = fold(`${section.title} ${section.aliases} ${value.group ?? ""} ${value.name} ${value.range}`);
      return terms.every((term) => hay.includes(term));
    })
    .map((value) => ({ ...value, section: section.title })));
}

const SUPER_SUB: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "⁺": "+", "⁻": "-",
};
