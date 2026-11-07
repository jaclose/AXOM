/**
 * AXOM Correspondents V1. Preference-based visual identities, not diagnoses.
 * Journal text is never accepted or returned. Only opted-in, user-reviewed
 * abstract tags may affect an initial suggestion.
 */
export const AXOM_CORRESPONDENTS = [
  { id: "meridian", name: "Meridian", localPart: "meridian", hue: 212, tags: ["planning","systems","visual"], description: "A precise route through the next piece of work." },
  { id: "vellum", name: "Vellum", localPart: "vellum", hue: 43, tags: ["writing","reflection","creative"], description: "A quiet keeper of ideas worth returning to." },
  { id: "fathom", name: "Fathom", localPart: "fathom", hue: 220, tags: ["research","precision","systems"], description: "A deeper inquiry into the mechanism beneath a result." },
  { id: "serein", name: "Serein", localPart: "serein", hue: 168, tags: ["calm","reflection","steady"], description: "A measured rhythm for careful, uninterrupted thinking." },
  { id: "lattice", name: "Lattice", localPart: "lattice", hue: 282, tags: ["systems","connection","visual"], description: "A visible structure linking one idea to another." },
  { id: "kestrel", name: "Kestrel", localPart: "kestrel", hue: 36, tags: ["precision","planning","practical"], description: "An exact eye for the decisive next detail." },
  { id: "morrow", name: "Morrow", localPart: "morrow", hue: 48, tags: ["planning","growth","steady"], description: "A thoughtful plan for the work on the horizon." },
  { id: "vela", name: "Vela", localPart: "vela", hue: 193, tags: ["exploration","planning","visual"], description: "A steady course across unfinished questions." },
  { id: "argent", name: "Argent", localPart: "argent", hue: 218, tags: ["precision","systems","research"], description: "A clean line between evidence and assumption." },
  { id: "atlas", name: "Atlas", localPart: "atlas", hue: 228, tags: ["systems","research","steady"], description: "A wide view that keeps the source in sight." },
  { id: "ember", name: "Ember", localPart: "ember", hue: 12, tags: ["creative","practical","growth"], description: "Small experiments carried into lasting progress." },
  { id: "solstice", name: "Solstice", localPart: "solstice", hue: 42, tags: ["reflection","growth","planning"], description: "A considered turning point in the longer cycle." },
  { id: "mosaic", name: "Mosaic", localPart: "mosaic", hue: 304, tags: ["connection","visual","creative"], description: "Many fragments arranged into one useful pattern." },
  { id: "quill", name: "Quill", localPart: "quill", hue: 38, tags: ["writing","research","reflection"], description: "A clear record of questions, sources and emerging ideas." },
  { id: "juniper", name: "Juniper", localPart: "juniper", hue: 135, tags: ["growth","steady","calm"], description: "A sustainable rhythm that leaves room to grow." },
  { id: "cipher", name: "Cipher", localPart: "cipher", hue: 222, tags: ["precision","systems","connection"], description: "A careful reader of hidden patterns and explicit evidence." },
  { id: "harbor", name: "Harbor", localPart: "harbor", hue: 181, tags: ["calm","steady","reflection"], description: "A composed place to gather, review and continue." },
  { id: "orrery", name: "Orrery", localPart: "orrery", hue: 202, tags: ["systems","visual","exploration"], description: "An orbital hummingbird whose mechanisms reveal cycles, feedback and time." },
  { id: "eidolon", name: "Eidolon", localPart: "eidolon", hue: 228, tags: ["research","reflection","exploration"], description: "A spectral wolf that turns unspoken assumptions into better questions." },
  { id: "rook", name: "Rook", localPart: "rook", hue: 220, tags: ["precision","reflection","systems"], description: "An obsidian rook that protects the record by recognizing meaningful exceptions." },
  { id: "tessera", name: "Tessera", localPart: "tessera", hue: 280, tags: ["visual","creative","systems"], description: "A prismatic beetle that builds useful models from tested fragments." },
  { id: "zephyr", name: "Zephyr", localPart: "zephyr", hue: 193, tags: ["exploration","planning","practical"], description: "A sky serpent that adjusts the route without surrendering the destination." },
  { id: "halcyon", name: "Halcyon", localPart: "halcyon", hue: 205, tags: ["precision","calm","planning"], description: "A kingfisher that discovers the value of stillness before commitment." },
  { id: "thistle", name: "Thistle", localPart: "thistle", hue: 114, tags: ["steady","practical","calm"], description: "A thorn-backed hedgehog that shelters a learner-chosen focus window." },
  { id: "calyx", name: "Calyx", localPart: "calyx", hue: 131, tags: ["growth","visual","reflection"], description: "A botanical glass mantis that makes gradual transformation legible." },
] as const;

export type CorrespondentId = (typeof AXOM_CORRESPONDENTS)[number]["id"];
export const CORRESPONDENT_ORDERS = {
  ARCHITECTS: ["meridian", "lattice", "atlas", "cipher", "orrery"],
  INVESTIGATORS: ["fathom", "eidolon", "argent", "kestrel", "rook"],
  ALCHEMISTS: ["vellum", "mosaic", "tessera", "quill", "ember"],
  WAYFINDERS: ["morrow", "vela", "zephyr", "solstice", "halcyon"],
  WARDENS: ["juniper", "serein", "harbor", "thistle", "calyx"],
} as const;
export type CorrespondentOrder = keyof typeof CORRESPONDENT_ORDERS;
function orderOf(id: string): CorrespondentOrder {
  return (Object.keys(CORRESPONDENT_ORDERS) as CorrespondentOrder[])
    .find(order => (CORRESPONDENT_ORDERS[order] as readonly string[]).includes(id)) ?? "ARCHITECTS";
}

export const CORRESPONDENT_STYLES = ["planning","systems","visual","writing","reflection","creative","research","precision","calm","steady","practical","growth","connection","exploration"] as const;
export type CorrespondentStyle = (typeof CORRESPONDENT_STYLES)[number];
type Card = (typeof AXOM_CORRESPONDENTS)[number];
export interface CorrespondentInput {
  userKey: string;
  academicHouse?: CorrespondentOrder;
  preferredRhythm?: "steady" | "focused" | "deep" | "bursts" | "flexible";
  supportStyle?: "encourage" | "challenge" | "neutral";
  selectedAccent?: string; // only a deliberately chosen color; not default #C8A96A
  declaredStyles?: readonly string[];
  journalOptIn?: boolean;
  journalThemes?: readonly string[]; // optional local abstract tags, never original text
  preferredId?: CorrespondentId;
}
export interface CorrespondentMatch {
  id: CorrespondentId;
  name: string;
  localPart: string;
  description: string;
  accent: string;
  basis: "starter" | "preferences" | "chosen";
  reasons: string[];
  inferredPersonality: false;
}
const allowed = new Set<string>(CORRESPONDENT_STYLES);
function styles(value?: readonly string[]) {
  return (Array.isArray(value) ? [...new Set(value.filter(t => typeof t === "string" && allowed.has(t)))].slice(0,3) : []);
}
function safeAccent(s?: string) { return s && /^#[\da-f]{6}$/i.test(s) ? s.toUpperCase() : undefined; }
function stableHash(s: string) { let h=2166136261; for (const c of s) { h ^= c.charCodeAt(0); h=Math.imul(h,16777619); } return h>>>0; }
function starter(card: Card): CorrespondentMatch {
  return { id:card.id,name:card.name,localPart:card.localPart,description:card.description,accent:"#C8A96A",
    basis:"starter",reasons:["AXOM assigned a starter correspondent from its 25-name collection. No personal writing was used."],inferredPersonality:false };
}
export function matchCorrespondent(input: CorrespondentInput): CorrespondentMatch {
  const chosen = AXOM_CORRESPONDENTS.find(c => c.id === input.preferredId);
  if (chosen) return { ...starter(chosen), basis: "chosen", reasons: ["You chose this correspondent."] };
  const accent = safeAccent(input.selectedAccent);
  // Only explicit academic preferences affect correspondence. Color changes presentation, not inferred personality.
  const declared = styles(input.declaredStyles);
  const journal = input.journalOptIn === true ? styles(input.journalThemes) : [];
  const hasEvidence = Boolean(input.academicHouse || input.preferredRhythm || input.supportStyle || declared.length || journal.length);
  const seed = stableHash(input.userKey || "axom");
  if (!hasEvidence) return { ...starter(AXOM_CORRESPONDENTS[seed % AXOM_CORRESPONDENTS.length]), accent: accent ?? "#C8A96A" };
  let selected: Card | undefined;
  let highest = -Infinity;
  const paceByOrder: Record<CorrespondentOrder, string> = { ARCHITECTS:"steady", SEEKERS:"deep", SENTINELS:"focused", KEEPERS:"deep", ALCHEMISTS:"bursts", WAYFINDERS:"flexible", WARDENS:"steady", LUMINARIES:"focused" };
  const supportByOrder: Record<CorrespondentOrder, string> = { ARCHITECTS:"challenge", SEEKERS:"neutral", SENTINELS:"challenge", KEEPERS:"encourage", ALCHEMISTS:"challenge", WAYFINDERS:"neutral", WARDENS:"encourage", LUMINARIES:"encourage" };
  for (const card of AXOM_CORRESPONDENTS) {
    const overlap = (tag: string) => (card.tags as readonly string[]).includes(tag);
    const order = orderOf(card.id);
    const score = (input.academicHouse === order ? 14 : 0)
      + declared.reduce((sum, tag) => sum + (overlap(tag) ? 5 : 0), 0)
      + journal.reduce((sum, tag) => sum + (overlap(tag) ? 2 : 0), 0)
      + (input.preferredRhythm === paceByOrder[order] ? 3 : 0)
      + (input.supportStyle === supportByOrder[order] ? 2 : 0)
      + stableHash((input.userKey || "axom") + "|" + card.id) / 0xFFFFFFFF * 0.0001;
    if (score > highest) { highest = score; selected = card; }
  }
  const reasons: string[] = [];
  if (input.academicHouse || declared.length || input.preferredRhythm || input.supportStyle) reasons.push("Academic study preferences contributed to this optional suggestion.");
  if (journal.length) reasons.push("An optional journal theme you reviewed locally informed this suggestion; no entry text was shared.");
  return { ...starter(selected!), accent: accent ?? "#C8A96A", basis:"preferences", reasons, inferredPersonality:false };
}

function escapeHtml(s:string){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));}
function orbUrl(raw?:string){try{const url=new URL(raw||"https://axom.info/icons/axom-orb-512.png");return url.protocol==="https:"&&["axom.info","www.axom.info"].includes(url.hostname)?url.href:"https://axom.info/icons/axom-orb-512.png";}catch{return "https://axom.info/icons/axom-orb-512.png";}}
export interface CorrespondentIntroOpts { displayName?:string; useCase:"welcome"|"preview"|"weekly_report"|"pulse"; orbUrl?:string; poc?:boolean }
export interface CorrespondentEmailPOC { subject:string;html:string;text:string }
export function renderCorrespondentIntroduction(match:CorrespondentMatch,options:CorrespondentIntroOpts):CorrespondentEmailPOC {
  const name=escapeHtml((options.displayName||"Learner").trim().slice(0,64)||"Learner"), alias=escapeHtml(match.name);
  // Narrative material is fictional. Matching evidence stays in the private settings UI.
  const explain="The Living Atlas opens to "+match.name+". "+match.description;
  const disclaimer="This is an AXOM fictional companion, not a personality assessment or a human support agent. No journal entry or private academic data appears in this email.";
  const subject=(options.poc===false?"AXOM · Meet ":"AXOM POC · "+options.useCase.toUpperCase().replaceAll("_"," ")+" · Meet ")+match.name;
  const font="Arial,Helvetica,sans-serif", mono="'Courier New',Consolas,monospace";
  const stage=(number:string,title:string,copy:string)=>[
    '<td valign="top" style="width:100%;padding:16px 14px;vertical-align:top;background:#252528;border:1px solid #494640">',
    '<p style="color:#C8A96A;font:10px '+mono+';margin:0 0 14px">'+number+'</p>',
    '<p style="color:#E6E2D6;font:bold 11px '+font+';margin:0 0 9px;letter-spacing:1px">'+title+'</p>',
    '<p style="color:#BCB7AC;font:12px/19px '+font+';margin:0">'+copy+'</p></td>'
  ].join("");
  const why='<tr><td style="border-top:1px solid #494640;color:#E6E2D6;font:13px/22px '+font+';padding:12px 0">'+escapeHtml(match.description)+'</td></tr>';
  const html=[
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>',escapeHtml(subject),'</title></head>',
    '<body style="margin:0;background:#0D0D0E;color:#E6E2D6;font-family:',font,'">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0D0D0E"><tr><td align="center" style="padding:26px 10px">',
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#1C1C1E;border:1px solid #48433C">',
    '<tr><td style="padding:25px 28px;border-bottom:1px solid #48433C"><table role="presentation" width="100%"><tr><td width="58"><img alt="AXOM Orb" src="',escapeHtml(orbUrl(options.orbUrl)),'" width="44" height="44" style="border:0;display:block"></td>',
    '<td style="font:bold 16px ',font,';color:#E6E2D6;letter-spacing:4px">AXOM<p style="font:10px ',mono,';letter-spacing:1px;color:#C8A96A;margin:5px 0 0">THE LIVING ATLAS</p></td>',
    '<td align="right" style="font:10px ',mono,';color:#BCB7AC">01 / 25</td></tr></table></td></tr>',
    '<tr><td style="padding:30px 28px"><table role="presentation"><tr><td width="90" height="3" bgcolor="',escapeHtml(match.accent),'"></td></tr></table>',
    '<p style="margin:25px 0 15px;color:#C8A96A;font:10px ',mono,';letter-spacing:1.3px">WELCOME TO AXOM / THE FIRST LETTER</p>',
    '<h1 style="font:normal 42px/49px Georgia,Times,serif;color:#E6E2D6;margin:0 0 19px">Welcome to AXOM, ',name,'.</h1>',
    '<p style="font:15px/26px ',font,';color:#E6E2D6;margin:0 0 17px">A private academic workspace built to connect what was taught, what you practiced, and what you truly understood.</p>',
    '<p style="font:14px/25px ',font,';color:#BCB7AC;margin:0 0 24px">AXOM brings your courses, source-linked questions, reviewed explanations and learning objectives into one coherent record. Its purpose is not to count how hard you worked. It is to help you see the evidence and choose a worthwhile next move.</p>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#252426;border:1px solid #504A3E;margin:0 0 27px"><tr><td style="padding:19px"><p style="font:10px ',mono,';color:#C8A96A;letter-spacing:1.4px;margin:0 0 10px">THE LIVING ATLAS / WHAT IT IS</p>',
    '<p style="font:14px/25px ',font,';color:#E6E2D6;margin:0">The Living Atlas is a fellowship of twenty-five fictional academic companions in five orders. Each has a story, learning method, strength and limitation. A companion is a character, never a diagnosis or a verdict on your personality.</p></td></tr></table>',
    '<p style="font:14px/25px ',font,';color:#BCB7AC;margin:0 0 21px">AXOM may suggest a starting companion using academic preferences you voluntarily share. Your choice takes precedence. You can change or turn off your companion in Settings, and private journal entries are excluded by default.</p>',
    '<p style="font:10px ',mono,';color:#C8A96A;letter-spacing:1.3px;margin:24px 0 13px">YOUR CORRESPONDENT / A FIRST ENCOUNTER</p>',
    '<h2 style="font:normal 43px/50px Georgia,Times,serif;color:#E6E2D6;margin:0 0 15px">Meet ',alias,'.</h2>',
    '<p style="font:15px/25px ',font,';color:#E6E2D6;margin:0 0 24px">',escapeHtml(explain),'</p>',
    '<table role="presentation" width="100%" cellspacing="3" cellpadding="0" style="margin-bottom:26px">',
    '<tr>',stage("01 / ORIGIN","THE ARCHIVE","Where the story begins"),'</tr>',
    '<tr>',stage("02 / NATURE","THE METHOD","How this creature learns"),'</tr>',
    '<tr>',stage("03 / COMPANION","A LIVING GUIDE",alias),'</tr>',
    '</table>',
    '<p style="font:10px ',mono,';color:#C8A96A;letter-spacing:1.4px;margin:0 0 9px">THE ACADEMIC NATURE</p>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">',why,'</table>',
    '<p style="color:#BCB7AC;font:13px/22px ',font,';margin:22px 0">',escapeHtml(match.description),'</p>',
    '<p style="background:#161618;border-left:2px solid #C8A96A;color:#BCB7AC;font:12px/20px ',font,';padding:17px;margin:0 0 25px">',escapeHtml(disclaimer),'</p>',
    '<p style="color:#BCB7AC;font:14px/23px ',font,';margin:0 0 21px">Begin with one course, one reviewed question or one trusted source. The Atlas will accompany the work, not replace it.</p>',
    '<a href="https://axom.info/#dashboard" style="background:#E6E2D6;color:#0D0D0E;display:inline-block;text-decoration:none;font:bold 13px ',font,';padding:15px 19px">Enter your workspace</a>',
    '<p style="font:11px/18px ',font,';color:#BCB7AC;margin:16px 0 0">You remain in control. <a href="https://axom.info/#communications" style="color:#D4B87E">Manage the companion and email preferences</a>.</p>',
    '</td></tr><tr><td style="border-top:1px solid #48433C;padding:20px 28px"><p style="color:#C8A96A;font:11px ',mono,';margin:0 0 8px">THE WORK, MADE LEGIBLE.</p>',
    '<p style="color:#BCB7AC;font:11px/19px ',font,';margin:0">This is an AXOM email identity, not a human support agent. Security mail always uses the official account sender.</p></td></tr>',
    '</table></td></tr></table></body></html>'
  ].join("");
  const text=[
    "AXOM / WELCOME TO THE WORKSPACE",
    "Welcome to AXOM, "+(options.displayName||"Learner")+".",
    "AXOM is a private academic workspace that connects your courses, questions, reviewed explanations and original sources so you can choose a better next step. It does not equate logged hours with mastery.",
    "WHAT IS THE LIVING ATLAS?",
    "The Living Atlas is a fellowship of twenty-five fictional academic companions in five orders. Each has a different story, learning method, strength and limitation. Companions are creative learning guides, not personality diagnoses.",
    "A starting character can be suggested from academic preferences you voluntarily share, or you can pick your own. You can change or turn off this companion at any time. Raw journal entries are excluded by default.",
    "YOUR CORRESPONDENT: "+match.name,
    explain,
    "ORIGIN -> NATURE -> COMPANION",
    "The character: "+match.description,
    disclaimer,
    "Begin with one course, reviewed question or trusted source.",
    "Enter your workspace: https://axom.info/#dashboard",
    "Companion and email preferences: https://axom.info/#communications",
    "This is a fictional AXOM correspondent, not a human support agent."
  ].join("\n\n");
  return {subject,html,text};
}
export interface CorrespondentSenderOptions { domain:string;verifiedDomains:readonly string[];replyTo:string }
const personalizedTypes=new Set(["welcome","daily_learning","daily_games","weekly_report","monthly_report","exam_reminder","inactivity","pulse"]);
export function correspondentSender(match:CorrespondentMatch,opts:CorrespondentSenderOptions,useCase="welcome") {
  if(!personalizedTypes.has(useCase))return null;
  const domain=opts.domain?.trim().toLowerCase(), replyTo=opts.replyTo?.trim();
  if(!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || !opts.verifiedDomains.some(v=>v.toLowerCase()===domain))return null;
  if(!replyTo || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(replyTo) || /[\r\n]/.test(replyTo))return null;
  return { from:"AXOM · "+match.name+" <"+match.localPart+"@"+domain+">",replyTo };
}
