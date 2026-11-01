/** Curated, source-checked teaching diagrams. Entries are independent of uploaded questions. */
export interface AxomDiagram {
  id: string;
  /** AXOM-owned classification; never written into source or user-uploaded tags. */
  topicTag: `axom:diagram:${string}`;
  topicLabel: string;
  title: string;
  subtitle: string;
  summary: string;
  answerAliases: readonly string[];
  illustration?: { path: string; alt: string };
  source: { title: string; url: string; reviewedOn: string };
}

export const AXOM_DIAGRAMS: readonly AxomDiagram[] = [
  {
    id: "rhinovirus-common-cold",
    topicTag: "axom:diagram:rhinovirus",
    topicLabel: "Respiratory virology",
    title: "Rhinovirus",
    subtitle: "Common cold · symptom pattern",
    summary: "Rhinoviruses are the most frequent cause of the common cold. Symptoms can resemble other respiratory infections.",
    answerAliases: ["rhinovirus", "human rhinovirus", "rhinovirus infection", "human rhinovirus infection"],
    source: {
      title: "CDC · About Rhinoviruses",
      url: "https://www.cdc.gov/rhinoviruses/about/index.html",
      reviewedOn: "2026-11-01",
    },
  },
  {
    id: "brachial-plexus-posterior-cord",
    topicTag: "axom:diagram:brachial-plexus",
    topicLabel: "Clinical anatomy",
    title: "Brachial plexus",
    subtitle: "Posterior cord · common pattern",
    summary: "Posterior divisions from the three trunks converge on the posterior cord. Its terminal branches include the axillary and radial nerves. Branching varies.",
    answerAliases: [],
    illustration: {
      path: "/academic-diagrams/brachial-plexus-posterior-cord.svg",
      alt: "Common brachial plexus pattern: C5 to T1 form three trunks. Each posterior division joins the posterior cord, which branches to axillary and radial nerves. Anterior divisions form the other cords.",
    },
    source: { title: "Adult brachial plexus dissection study", url: "https://pubmed.ncbi.nlm.nih.gov/32100569/", reviewedOn: "2026-11-01" },
  },
  {
    id: "fibrocartilage-pattern",
    topicTag: "axom:diagram:fibrocartilage",
    topicLabel: "Histology",
    title: "Fibrocartilage",
    subtitle: "Matrix and cell pattern",
    summary: "Rows of chondrocytes lie between thick collagen bundles. Fibrocartilage lacks a perichondrium; this schematic is not the question's source image.",
    answerAliases: [],
    illustration: {
      path: "/academic-diagrams/fibrocartilage.svg",
      alt: "Fibrocartilage teaching schematic with chondrocytes in lacunae arranged in rows between thick collagen bundles, and no perichondrium at the tissue margin.",
    },
    source: { title: "IU School of Medicine · Virtual Histology", url: "https://vmicro.iusm.iu.edu/hs_vm/docs/lab2_3.htm", reviewedOn: "2026-11-01" },
  },
  {
    id: "inguinal-region-routes",
    topicTag: "axom:diagram:inguinal-region",
    topicLabel: "Clinical anatomy",
    title: "Inguinal region",
    subtitle: "Indirect and direct routes",
    summary: "An indirect route enters the deep ring lateral to the inferior epigastric vessels. A direct route passes medial to them.",
    answerAliases: [],
    illustration: {
      path: "/academic-diagrams/inguinal-region.svg",
      alt: "Posterior-view inguinal schematic showing the indirect route through the deep ring lateral to the inferior epigastric vessels, and the direct route medial to the vessels.",
    },
    source: { title: "Ultrasound and surgical comparison", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9402849/", reviewedOn: "2026-11-01" },
  },
  {
    id: "neuromuscular-transmission-presynaptic",
    topicTag: "axom:diagram:neuromuscular-transmission",
    topicLabel: "Neurophysiology",
    title: "Neuromuscular transmission",
    subtitle: "Presynaptic calcium and acetylcholine release",
    summary: "Calcium entry at the motor-nerve terminal supports acetylcholine release. Reduced presynaptic entry reduces release at the endplate.",
    answerAliases: [],
    illustration: {
      path: "/academic-diagrams/neuromuscular-transmission.svg",
      alt: "Two neuromuscular-junction panels compare normal presynaptic calcium entry and acetylcholine release with reduced calcium entry and reduced release toward the muscle endplate.",
    },
    source: { title: "Presynaptic vesicle-release study", url: "https://pubmed.ncbi.nlm.nih.gov/25589670/", reviewedOn: "2026-11-01" },
  },
  {
    id: "posterior-abdominal-wall-genitofemoral",
    topicTag: "axom:diagram:genitofemoral",
    topicLabel: "Clinical anatomy",
    title: "Posterior abdominal wall",
    subtitle: "Genitofemoral course over psoas",
    summary: "The genitofemoral nerve emerges on the anterior surface of psoas major and divides into genital and femoral branches. Branch paths vary.",
    answerAliases: [],
    illustration: {
      path: "/academic-diagrams/posterior-abdominal-wall.svg",
      alt: "Lumbar-plexus schematic with the genitofemoral nerve emerging onto the anterior psoas surface and dividing into genital and femoral branches.",
    },
    source: { title: "Cadaveric lumbar plexus study", url: "https://pubmed.ncbi.nlm.nih.gov/12616150/", reviewedOn: "2026-11-01" },
  },
  {
    id: "repeat-disorders-dmpk",
    topicTag: "axom:diagram:dmpk",
    topicLabel: "Medical genetics",
    title: "DMPK repeat expansion",
    subtitle: "Myotonic dystrophy type 1",
    summary: "The CTG repeat expands in the 3′ untranslated region of DMPK. This locus map concerns myotonic dystrophy type 1.",
    answerAliases: [],
    illustration: {
      path: "/academic-diagrams/repeat-disorders.svg",
      alt: "DMPK gene schematic placing an expanded CTG DNA repeat after the stop codon in the 3-prime untranslated region, with the corresponding CUG repeat in RNA.",
    },
    source: { title: "DMPK CTG repeat discovery", url: "https://pubmed.ncbi.nlm.nih.gov/1310900/", reviewedOn: "2026-11-01" },
  },
];
