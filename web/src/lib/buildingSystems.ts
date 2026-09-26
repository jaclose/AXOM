export type BuildStatus = "foundation" | "in-development" | "planned" | "research";
export interface SystemPreview { id: string; name: string; status: BuildStatus; area: string; promise: string; connectsTo: string[]; }
export const SYSTEM_PREVIEWS: SystemPreview[] = [
  { id:"course-central", name:"Course Central", status:"foundation", area:"Learning", promise:"Unify courses, modules, objectives, resources, and progress around one academic home.", connectsTo:["Course Tracker","Knowledge Graph","Recommendations"] },
  { id:"knowledge-graph", name:"Knowledge Graph", status:"research", area:"Knowledge", promise:"Connect concepts, evidence, questions, and learning history without pretending the graph exists today.", connectsTo:["Medical Textbook","Semantic Search","AI Tutor"] },
  { id:"medical-textbook", name:"Medical Textbook", status:"planned", area:"Knowledge", promise:"A learner-owned, source-aware reference assembled from verified study material.", connectsTo:["Knowledge Graph","Equation Explorer"] },
  { id:"equation-explorer", name:"Equation Explorer", status:"planned", area:"Reasoning", promise:"Explain medical equations, variables, assumptions, and clinical interpretation interactively.", connectsTo:["Medical Textbook","Physiology Simulator"] },
  { id:"ai-tutor", name:"AI Tutor", status:"research", area:"Reasoning", promise:"Grounded coaching that cites learner-approved material and exposes uncertainty.", connectsTo:["Knowledge Graph","Question Bank"] },
  { id:"semantic-search", name:"Semantic Search", status:"research", area:"Knowledge", promise:"Find related meaning across owned sources after deterministic search and provenance are stable.", connectsTo:["Knowledge Graph","Question Bank"] },
  { id:"knowledge-attrition", name:"Knowledge Attrition", status:"planned", area:"Analytics", promise:"Estimate what may be fading using transparent evidence and learner confirmation.", connectsTo:["Course Tracker","Recommendations"] },
  { id:"physiology-simulator", name:"Physiology Simulator", status:"research", area:"Simulation", promise:"Explore cause and effect across physiological variables in bounded teaching models.", connectsTo:["Equation Explorer","Patient Builder"] },
  { id:"patient-builder", name:"Patient Builder", status:"research", area:"Simulation", promise:"Construct synthetic clinical cases for reasoning practice with explicit educational constraints.", connectsTo:["Physiology Simulator","AI Tutor"] },
  { id:"accounts-sync", name:"Accounts & Sync", status:"in-development", area:"Platform", promise:"Optional sign-in with versioned cloud protection, conflict-safe multi-device use, restore history, and one-click deletion — local ownership stays first.", connectsTo:["All learner data","Backups","Native AXOM"] },
  { id:"native-axom", name:"Native AXOM", status:"planned", area:"Platform", promise:"Package a stable web product after accounts, sync, PWA, and offline behavior are proven.", connectsTo:["PWA","Accounts & Sync"] },
];
