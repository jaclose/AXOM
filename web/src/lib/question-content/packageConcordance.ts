// Structural equivalence gate for two parser representations of one source.
// This does not parse, correct, de-duplicate or install any questions.
// It is deliberately strict: when two renderers disagree, preserve both
// private candidates for inspection rather than silently replacing one.
import { blocksToPlainText } from "./blocks";
import type { ImportPackage, PackageQuestion } from "./package";

export interface PackagePairResult {
  sourceChecksum: string | undefined;
  originalCount: number;
  candidateCount: number;
  unambiguousSourceIdentity: boolean;
  fullQuestionMatch: boolean;
  answerConflicts: number;
  sourcePageConflicts: number;
  unmatched: number;
  concordant: number;
  /** Safe only for replacing a less structured *review-only* candidate. */
  replacementSafe: boolean;
  reasons: string[];
  questions: Array<{
    source: string;
    originalId?: string;
    candidateId?: string;
    stemSimilarity?: number;
    choiceSimilarity?: number;
    answerMatch: boolean;
    matched: boolean;
  }>;
}
function normalize(text: string) {
  return text.normalize("NFC").toLowerCase()
    .replace(/\[image(?::[^\]]+)?\]/g, " ")
    .replace(/\s+/g, " ").replace(/[^\p{L}\p{N}]+/gu, "").trim();
}
function score(a: string, b: string): number {
  if (a===b) return 1;
  if (!a.length || !b.length || Math.min(a.length,b.length)<8) return 0;
  const trigrams=(v:string)=>{
    const map=new Map<string,number>();
    for(let i=0;i+3<=v.length;i++)map.set(v.slice(i,i+3),(map.get(v.slice(i,i+3))??0)+1);
    return map;
  };
  const aTokens=trigrams(a),bTokens=trigrams(b);
  let common=0, total=0;
  for(const count of aTokens.values())total+=count;
  for(const count of bTokens.values())total+=count;
  for(const [token,count] of aTokens)common+=Math.min(count,bTokens.get(token)??0);
  return total?2*common/total:0;
}
const originalIdentity=(q:PackageQuestion)=>q.source.questionNumber;
const qualifiedIdentity=(q:PackageQuestion)=>`${q.source.set??0}:${q.source.questionNumber??"?"}`;
function checksumOf(pkg:ImportPackage):string|undefined{
  const values=new Set(pkg.questions.map(q=>q.provenance.sourceChecksum).filter(Boolean));
  const value=values.size===1?[...values][0]:undefined;
  return value && /^sha256:[a-f0-9]{64}$/.test(value)?value:undefined;
}
function labelsUnique(questions:readonly PackageQuestion[]):boolean{
  const names=questions.map(q=>originalIdentity(q));
  return names.every(v=>v!==undefined)&&names.length===new Set(names).size;
}
export function comparePackageVariants(original:ImportPackage, candidate:ImportPackage):PackagePairResult{
  const originChecksum=checksumOf(original), candidateChecksum=checksumOf(candidate);
  const originalCount=original.questions.length,candidateCount=candidate.questions.length;
  const useSingleNumber=labelsUnique(original.questions)&&labelsUnique(candidate.questions);
  const key=(q:PackageQuestion)=>useSingleNumber?String(q.source.questionNumber):qualifiedIdentity(q);
  const originalMap=new Map<string,PackageQuestion[]>();
  const candidateMap=new Map<string,PackageQuestion[]>();
  for(const q of original.questions)originalMap.set(key(q),[...(originalMap.get(key(q))??[]),q]);
  for(const q of candidate.questions)candidateMap.set(key(q),[...(candidateMap.get(key(q))??[]),q]);
  const idUnique=[...originalMap.values(),...candidateMap.values()].every(rows=>rows.length===1)
    && original.questions.every(q=>q.source.questionNumber!==undefined)
    && candidate.questions.every(q=>q.source.questionNumber!==undefined);
  const rows:PackagePairResult["questions"]=[];
  let answerConflicts=0,sourcePageConflicts=0,unmatched=0,concordant=0;
  for(const [identity,originRows] of originalMap){
    const choices=candidateMap.get(identity)??[];
    const orig=originRows.length===1?originRows[0]:undefined;
    const incoming=choices.length===1?choices[0]:undefined;
    if(!orig||!incoming){unmatched++;rows.push({source:identity,originalId:orig?.id,candidateId:incoming?.id,answerMatch:false,matched:false});continue;}
    const stemSimilarity=score(normalize(blocksToPlainText(orig.stem)),normalize(blocksToPlainText(incoming.stem)));
    const choicesComparable=orig.choices.length>=2 && orig.choices.length===incoming.choices.length
      && orig.choices.every((choice,index)=>choice.label===incoming.choices[index]?.label);
    const similarities=choicesComparable?orig.choices.map((choice,index)=>score(
      normalize(blocksToPlainText(choice.blocks)),normalize(blocksToPlainText(incoming.choices[index].blocks)))):[];
    const choiceSimilarity=choicesComparable?Math.min(...similarities):0;
    const answerMatch= !orig.correctAnswer || !incoming.correctAnswer
      || JSON.stringify(orig.correctAnswer.labels)===JSON.stringify(incoming.correctAnswer.labels);
    if(!answerMatch) answerConflicts++;
    if(orig.source.page!==undefined&&incoming.source.page!==undefined&&orig.source.page!==incoming.source.page)sourcePageConflicts++;
    const matched=stemSimilarity>=.985 && choiceSimilarity>=.985 && answerMatch;
    if(matched) concordant++;
    rows.push({source:identity,originalId:orig.id,candidateId:incoming.id,
      stemSimilarity:Number(stemSimilarity.toFixed(4)),
      choiceSimilarity:Number(choiceSimilarity.toFixed(4)),answerMatch,matched});
  }
  for(const [identity,incoming] of candidateMap)if(!originalMap.has(identity)){
    unmatched+=incoming.length;
    rows.push({source:identity,candidateId:incoming.length===1?incoming[0].id:undefined,answerMatch:false,matched:false});
  }
  const reasons:string[]=[];
  if(!originChecksum||originChecksum!==candidateChecksum)reasons.push("The two package versions have different or unverified original file hashes.");
  if(originalCount!==candidateCount)reasons.push("Question counts differ across extraction methods.");
  if(!idUnique)reasons.push("Source question numbers or set identities are ambiguous.");
  if(unmatched)reasons.push("Some original source questions have no unique match.");
  if(answerConflicts)reasons.push(`${answerConflicts} extracted answer labels disagree; no answer may be transferred.`);
  if(sourcePageConflicts)reasons.push(`${sourcePageConflicts} source page locations differ; check the original visually.`);
  if(concordant!==originalCount)reasons.push("Stem/choice text does not fully correspond at the strict fidelity threshold.");
  const replacementSafe=reasons.length===0;
  return {sourceChecksum:originChecksum,originalCount,candidateCount,
    unambiguousSourceIdentity:idUnique,fullQuestionMatch:concordant===originalCount,
    answerConflicts,sourcePageConflicts,unmatched,concordant,replacementSafe,reasons,questions:rows};
}
