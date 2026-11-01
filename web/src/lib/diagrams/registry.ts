/** Curated, source-checked teaching diagrams. Entries are independent of uploaded questions. */
export interface AxomDiagram {
  id: string;
  /** AXOM-owned classification; never written into source or user-uploaded tags. */
  topicTag: `axom:diagram:${string}`;
  title: string;
  subtitle: string;
  answerAliases: readonly string[];
  source: { title: string; url: string; reviewedOn: string };
}

export const AXOM_DIAGRAMS: readonly AxomDiagram[] = [
  {
    id: "rhinovirus-common-cold",
    topicTag: "axom:diagram:rhinovirus",
    title: "Rhinovirus",
    subtitle: "Common cold · symptom pattern",
    answerAliases: ["rhinovirus", "human rhinovirus", "rhinovirus infection", "human rhinovirus infection"],
    source: {
      title: "CDC · About Rhinoviruses",
      url: "https://www.cdc.gov/rhinoviruses/about/index.html",
      reviewedOn: "2026-11-01",
    },
  },
];
