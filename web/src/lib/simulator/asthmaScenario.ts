export type SimulationStage = "reference" | "asthma" | "albuterol";
export type BodyRegion = "airways" | "heart" | "hands";

export interface EvidenceSource {
  id: string;
  label: string;
  url: string;
}

export interface RegionObservation {
  label: string;
  heading: string;
  explanation: string;
  boundary: string;
  sourceIds: readonly string[];
}

export const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  {
    id: "nhlbi-asthma",
    label: "NHLBI: What is asthma?",
    url: "https://www.nhlbi.nih.gov/health/asthma",
  },
  {
    id: "nhlbi-causes",
    label: "NHLBI: Causes and triggers",
    url: "https://www.nhlbi.nih.gov/health/asthma/causes",
  },
  {
    id: "medline-quick-relief",
    label: "MedlinePlus: Asthma quick-relief drugs",
    url: "https://medlineplus.gov/ency/patientinstructions/000008.htm",
  },
  {
    id: "medline-albuterol",
    label: "MedlinePlus: Albuterol oral inhalation",
    url: "https://medlineplus.gov/druginfo/meds/a682145.html",
  },
] as const;

export const SIMULATION_STAGES: readonly { id: SimulationStage; label: string; cue: string }[] = [
  { id: "reference", label: "Reference", cue: "A comparison drawing of an open airway." },
  { id: "asthma", label: "Asthma", cue: "Inflammation and tightening narrow the airway." },
  { id: "albuterol", label: "Inhaled albuterol", cue: "Airway muscle relaxes. Asthma is still present." },
] as const;

export const BODY_REGIONS: readonly { id: BodyRegion; label: string; number: string }[] = [
  { id: "airways", label: "Airways", number: "01" },
  { id: "heart", label: "Heart", number: "02" },
  { id: "hands", label: "Hands", number: "03" },
] as const;

export const REGION_OBSERVATIONS: Readonly<Record<SimulationStage, Readonly<Record<BodyRegion, RegionObservation>>>> = {
  reference: {
    airways: {
      label: "Comparison",
      heading: "An open airway",
      explanation: "This stylized cross-section gives you a reference for the narrowing shown in asthma.",
      boundary: "The drawing is qualitative and not to scale.",
      sourceIds: ["nhlbi-asthma"],
    },
    heart: {
      label: "Outside this view",
      heading: "No heart effect modeled",
      explanation: "The reference stage only sets up the airway comparison.",
      boundary: "It does not represent a person's cardiovascular state.",
      sourceIds: [],
    },
    hands: {
      label: "Outside this view",
      heading: "No hand effect modeled",
      explanation: "The reference stage only sets up the airway comparison.",
      boundary: "It does not represent a person's neurologic or muscular state.",
      sourceIds: [],
    },
  },
  asthma: {
    airways: {
      label: "Pathology",
      heading: "Less room for air",
      explanation: "Asthma can inflame and narrow the airways. The surrounding muscle may tighten, and the airway can make more mucus.",
      boundary: "Severity varies. This view does not predict airflow or symptoms for a person.",
      sourceIds: ["nhlbi-asthma", "nhlbi-causes"],
    },
    heart: {
      label: "Not modeled",
      heading: "Keep the focus on the airway",
      explanation: "This stage shows the airway changes described by NHLBI. It does not calculate effects elsewhere in the body.",
      boundary: "No patient-specific physiology is inferred.",
      sourceIds: ["nhlbi-asthma"],
    },
    hands: {
      label: "Not modeled",
      heading: "Keep the focus on the airway",
      explanation: "This stage shows the airway changes described by NHLBI. It does not calculate effects elsewhere in the body.",
      boundary: "No patient-specific physiology is inferred.",
      sourceIds: ["nhlbi-asthma"],
    },
  },
  albuterol: {
    airways: {
      label: "Drug action",
      heading: "Muscle relaxes; the passage opens",
      explanation: "Inhaled albuterol is a quick-relief bronchodilator. It relaxes airway muscle and opens the air passages to make breathing easier.",
      boundary: "This illustrates a mechanism, not a measured response. Albuterol controls symptoms but does not cure asthma.",
      sourceIds: ["medline-quick-relief", "medline-albuterol"],
    },
    heart: {
      label: "Possible adverse effect",
      heading: "Heart rhythm matters",
      explanation: "A fast, pounding, or irregular heartbeat is a possible serious effect of inhaled albuterol.",
      boundary: "Possible does not mean expected. This map cannot estimate an individual's risk.",
      sourceIds: ["medline-albuterol"],
    },
    hands: {
      label: "Possible adverse effect",
      heading: "Shakiness can occur",
      explanation: "Shaking or tremor is a possible effect of inhaled albuterol.",
      boundary: "This map does not predict whether it will happen or how severe it would be.",
      sourceIds: ["medline-albuterol", "medline-quick-relief"],
    },
  },
} as const;

export function sourcesFor(observation: RegionObservation): EvidenceSource[] {
  return observation.sourceIds.flatMap((id) => {
    const source = EVIDENCE_SOURCES.find((candidate) => candidate.id === id);
    return source ? [source] : [];
  });
}
