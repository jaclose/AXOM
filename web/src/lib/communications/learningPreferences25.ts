import type { CorrespondentId } from "./correspondents";

/** Original exploratory academic-preference questions. Not MBTI, NERIS or a validated personality assessment. */
export const ATLAS25_AXES = [
  { id: "sensemaking", name: "Sensemaking", low: "Mechanism-first", high: "Connection-first" },
  { id: "route", name: "Study route", low: "Structured sequence", high: "Exploratory navigation" },
  { id: "practice", name: "Practice entry", low: "Attempt early", high: "Build then retrieve" },
  { id: "feedback", name: "Feedback voice", low: "Direct challenge", high: "Guided support" },
  { id: "momentum", name: "Work rhythm", low: "Focused sprints", high: "Steady cadence" },
  { id: "view", name: "Orientation", low: "Detail-first", high: "Systems-first" },
] as const;
export type Atlas25Axis = typeof ATLAS25_AXES[number]["id"];
export type Atlas25Item = { id: string; axis: Atlas25Axis; key: 1 | -1; statement: string };
const item = (id: string, axis: Atlas25Axis, key: 1 | -1, statement: string): Atlas25Item => ({id,axis,key,statement});
export const ATLAS25_ITEMS: readonly Atlas25Item[] = [
  item("Q01","sensemaking",-1,"When a topic is unfamiliar, I first trace the causal steps that produce the observed result."),
  item("Q02","sensemaking",1,"An analogy from another subject often gives me the best starting point."),
  item("Q03","sensemaking",-1,"I would rather test one mechanism than collect several possible connections."),
  item("Q04","sensemaking",1,"I understand an idea faster when I first map how it relates to other ideas."),
  item("Q05","sensemaking",1,"A good explanation shows me a pattern I can reuse in a different topic."),
  item("Q06","route",-1,"Knowing the next three steps makes it easier for me to begin studying."),
  item("Q07","route",1,"I prefer following a useful new question even when it changes my plan."),
  item("Q08","route",-1,"A predictable study sequence reduces friction for me."),
  item("Q09","route",1,"A flexible list of options serves me better than a fixed study order."),
  item("Q10","route",-1,"I like ending a session with the next task already decided."),
  item("Q11","practice",-1,"Trying a practice question before reviewing the full topic helps me see the gap."),
  item("Q12","practice",1,"I prefer building a conceptual outline before the first retrieval question."),
  item("Q13","practice",-1,"I learn something useful from an early wrong answer, even without full preparation."),
  item("Q14","practice",1,"I want a brief source-grounded model before applying it to an unfamiliar case."),
  item("Q15","practice",-1,"I would rather attempt a case with partial knowledge than wait until I feel ready."),
  item("Q16","feedback",-1,"After an error, I want the precise flaw stated immediately."),
  item("Q17","feedback",1,"A calm framing helps me engage with a difficult correction."),
  item("Q18","feedback",-1,"A direct challenge is more useful to me than reassurance."),
  item("Q19","feedback",1,"When a session goes badly, I prefer a small next step before a full critique."),
  item("Q20","feedback",-1,"I prefer corrections that are short, exact and unsoftened."),
  item("Q21","momentum",-1,"One long concentration block suits me better than several short blocks."),
  item("Q22","momentum",1,"I would rather protect a manageable daily study routine than rely on occasional marathons."),
  item("Q23","momentum",-1,"I feel most productive when I can work intensely and recover afterward."),
  item("Q24","momentum",1,"Regular, modest study sessions fit my way of working."),
  item("Q25","momentum",-1,"If I have a hard task, I prefer clearing a long uninterrupted period for it."),
  item("Q26","view",-1,"A concrete next action is usually more useful to me than a summary of the entire term."),
  item("Q27","view",1,"Seeing how topics depend on each other helps me decide where to focus."),
  item("Q28","view",-1,"When I review performance, I inspect individual examples before reading the trend."),
  item("Q29","view",1,"I prefer a dashboard that begins with the whole academic picture."),
  item("Q30","view",1,"I am more confident in a plan when it shows how today's task supports the larger goal."),
];

/** Round-robin interleaving ensures each axis has three observations by item 18. */
export const ATLAS25_ORDER: readonly Atlas25Item[] = Array.from({length:5},(_,round)=>ATLAS25_AXES.map(axis => ATLAS25_ITEMS.filter(q=>q.axis===axis.id)[round])).flat();

export type Atlas25Vector = readonly [number,number,number,number,number,number];
/** Design centroids only. These are not estimated population norms or psychological scores. */
export const ATLAS25_TARGETS: Record<CorrespondentId,Atlas25Vector> = {
  meridian:[23,17,67,24,68,92],lattice:[88,38,66,30,68,91],atlas:[48,26,78,74,92,83],
  cipher:[15,43,19,8,44,61],orrery:[87,51,71,38,35,97],
  fathom:[18,54,88,63,82,69],eidolon:[72,81,73,74,61,64],argent:[17,27,34,8,58,26],
  kestrel:[35,64,14,7,21,21],rook:[30,39,23,19,74,41],
  vellum:[76,59,86,77,86,36],mosaic:[95,91,70,69,44,89],tessera:[64,32,84,48,77,72],
  quill:[57,43,81,30,72,31],ember:[81,76,27,75,18,54],
  morrow:[36,18,33,73,76,36],vela:[84,90,33,61,41,73],zephyr:[83,97,18,36,15,67],
  solstice:[51,39,60,71,88,88],halcyon:[24,43,13,29,48,22],
  juniper:[49,31,53,94,98,45],serein:[27,54,70,93,79,28],harbor:[52,43,44,96,86,74],
  thistle:[20,71,24,14,70,30],calyx:[82,60,68,91,82,87],
};
export type Atlas25AxisScore = { score: number | null; count: number; variation: number | null };
export type Atlas25Assessment = { axes: Record<Atlas25Axis,Atlas25AxisScore>; answered: number; eligible: boolean; provisional: boolean };
const WEIGHTS: Record<Atlas25Axis,number> = {sensemaking:1.15,route:1.08,practice:1.12,feedback:.91,momentum:.98,view:1.12};
export function scoreAtlas25(responses: Record<string,number>): Atlas25Assessment {
  const axes = {} as Record<Atlas25Axis,Atlas25AxisScore>;
  for(const axis of ATLAS25_AXES) {
    const values = ATLAS25_ITEMS.filter(q => q.axis===axis.id && Number.isInteger(responses[q.id]) && responses[q.id]>=1 && responses[q.id]<=7)
      .map(q => q.key===1 ? responses[q.id] : 8-responses[q.id]);
    const count=values.length; const average = count ? values.reduce((a,b)=>a+b,0)/count : null;
    const variation = average===null ? null : Math.sqrt(values.reduce((a,b)=>a+(b-average)**2,0)/count);
    axes[axis.id]={score:average===null?null:Math.round((average-1)/6*100),count,variation:variation===null?null:Math.round(variation*100)/100};
  }
  const answered=Object.values(axes).reduce((n,x)=>n+x.count,0);
  const eligible=Object.values(axes).every(x=>x.count>=3);
  return {axes,answered,eligible,provisional:eligible&&answered<30};
}
export function rankAtlas25(assessment: Atlas25Assessment) {
  if(!assessment.eligible)return [] as {id:CorrespondentId;distance:number;fit:number}[];
  return (Object.entries(ATLAS25_TARGETS) as [CorrespondentId,Atlas25Vector][]).map(([id,centroid])=>{
    let sum=0, weight=0;
    ATLAS25_AXES.forEach((a,i)=>{
      const score=assessment.axes[a.id].score;
      if(score===null)return;
      const w=WEIGHTS[a.id];sum+=w*(score-centroid[i])**2;weight+=w;
    });
    const distance=Math.sqrt(sum/weight);
    const fit=Math.round(100*Math.exp(-(distance**2)/(2*37**2)));
    return {id,distance:Math.round(distance*10)/10,fit};
  }).sort((a,b)=>a.distance-b.distance || a.id.localeCompare(b.id));
}
export function recommendAxom25(assessment: Atlas25Assessment) {
  if(!assessment.eligible)return null;
  const layout = Object.fromEntries(ATLAS25_AXES.map(axis=>{
    const v=assessment.axes[axis.id].score;
    const band=v!==null&&v<=42?"low":v!==null&&v>=58?"high":"mixed";
    return [axis.id,{band,mode:"suggested",requiresApproval:true}];
  })) as Record<Atlas25Axis,{band:"low"|"high"|"mixed";mode:"suggested";requiresApproval:true}>;
  return {schema:"axom.learning-preferences.v3",layout,previewOnly:true,requiresApproval:true,
    marketingSubscribed:false,journalAccess:false,canChangeAnswerKeys:false,canChangeGrades:false};
}
