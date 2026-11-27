import { expect,it } from "vitest";
import { matchChallengeQuestions, readDailyChallenges, readDailyStandings, type DailyChallenge } from "./challenges";
import type { QuestionRecord } from "../questions";
const hash=`sha256:${"a".repeat(64)}`;
const challenge={questionCount:1,questions:[{key:"bank:q1",bankId:"bank",questionId:"q1",sourceChecksum:hash}]} as DailyChallenge;
const question=(id="local",bankId:string|undefined="bank")=>({id,content:{id:"q1",bankId,provenance:{sourceChecksum:hash},assets:[]},correctKey:"A",options:[{key:"A",text:"a"},{key:"B",text:"b"}]} as unknown as QuestionRecord);
it("matches a reviewed exact source identity, including unique legacy manifest inheritance",()=>{
  expect([...matchChallengeQuestions(challenge,[question()])]).toEqual([["local","bank:q1"]]);
  const old=question();delete old.content!.bankId;
  expect([...matchChallengeQuestions(challenge,[old])]).toEqual([["local","bank:q1"]]);
});
it("refuses ambiguous, wrong-version, generated and incomplete pools",()=>{
  expect(()=>matchChallengeQuestions(challenge,[question("a"),question("b")])).toThrow(/Load/);
  expect(()=>matchChallengeQuestions(challenge,[question("a","other")])).toThrow(/Load/);
  const changed=question();changed.content!.provenance.sourceChecksum=`sha256:${"b".repeat(64)}`;
  expect(()=>matchChallengeQuestions(challenge,[changed])).toThrow(/Load/);
  expect(()=>matchChallengeQuestions(challenge,[{...question(),ai:{generated:true}}])).toThrow(/Load/);
  expect(()=>matchChallengeQuestions(challenge,[])).toThrow(/Load/);
});
const id1="11111111-1111-4111-8111-111111111111";
const id2="22222222-2222-4222-8222-222222222222";
const id3="33333333-3333-4333-8333-333333333333";
const validChallenge={
  id:id1,collectionId:id2,revisionId:id3,module:"Cardiovascular",day:"2026-11-23",
  questionCount:1,questions:[{key:"bank:q1",bankId:"bank",questionId:"q1",sourceChecksum:hash}],
  participation:{alias:"Learner",visible:true},
};
it("accepts a complete source-identifiable shared challenge and an empty server page",()=>{
  expect(readDailyChallenges([validChallenge])).toEqual([validChallenge]);
  expect(readDailyChallenges([])).toEqual([]);
  expect(readDailyChallenges([{...validChallenge,participation:null}])).toHaveLength(1);
  // PostgreSQL length() counts Unicode characters, not UTF-16 code units.
  expect(readDailyChallenges([{...validChallenge,participation:{alias:"🙂".repeat(32),visible:true}}])).toHaveLength(1);
});
it("rejects malformed challenge identity, placement, participation and repeated canonical keys",()=>{
  const invalid=[
    {...validChallenge,collectionId:undefined},
    {...validChallenge,revisionId:"not-a-uuid"},
    {...validChallenge,id:"unexpected"},
    {...validChallenge,module:" "},
    {...validChallenge,day:"not-a-date"},
    {...validChallenge,participation:{alias:"",visible:true}},
    {...validChallenge,participation:{alias:"Learner",visible:"yes"}},
    {...validChallenge,questions:[{...validChallenge.questions[0],key:"other:q1"}]},
    {...validChallenge,questions:[{...validChallenge.questions[0],sourceChecksum:"invalid"}]},
    {...validChallenge,questionCount:2,questions:[validChallenge.questions[0],validChallenge.questions[0]]},
  ];
  for(const bad of invalid) expect(()=>readDailyChallenges([bad])).toThrow(/invalid/i);
  expect(()=>readDailyChallenges([validChallenge,validChallenge])).toThrow(/invalid/i);
});
const standing={rows:[
  {alias:"Alpha",points:1,answered:2,rank:1,you:true},
  {alias:"Beta",points:1,answered:1,rank:1,you:false},
],yourRank:1,participants:2};
it("accepts valid ranked, tied, bounded standings and empty standings",()=>{
  expect(readDailyStandings(standing)).toEqual(standing);
  const unicode={...standing,rows:[{...standing.rows[0],alias:"🙂".repeat(32)},standing.rows[1]]};
  expect(readDailyStandings(unicode)).toEqual(unicode);
  expect(readDailyStandings({rows:[],yourRank:null,participants:0})).toEqual({rows:[],yourRank:null,participants:0});
});
it("rejects standings that would crash rendering or misstate rank and progress",()=>{
  const invalid=[
    {...standing,rows:[null]},
    {...standing,rows:[{...standing.rows[0],alias:""}]},
    {...standing,rows:[{...standing.rows[0],points:-1}]},
    {...standing,rows:[{...standing.rows[0],points:3}]},
    {...standing,rows:[{...standing.rows[0],answered:"2"}]},
    {...standing,rows:[{...standing.rows[0],rank:0}]},
    {...standing,rows:[{...standing.rows[0],you:"true"}]},
    {...standing,rows:[{...standing.rows[0],you:true},{...standing.rows[1],you:true}]},
    {...standing,participants:1},
    {...standing,participants:2.5},
    {...standing,yourRank:0},
    {...standing,yourRank:3},
    {...standing,rows:[{...standing.rows[0],rank:2}],yourRank:1},
  ];
  for(const bad of invalid) expect(()=>readDailyStandings(bad)).toThrow(/Standings/);
});


it("rejects rank sequences inconsistent with SQL dense_rank(points DESC)",()=>{
  const invalid=[
    {rows:[{alias:"Alpha",points:0,answered:1,rank:1,you:true},{alias:"Beta",points:1,answered:1,rank:2,you:false}],yourRank:1,participants:2},
    {rows:[{alias:"Alpha",points:1,answered:1,rank:1,you:true},{alias:"Beta",points:1,answered:1,rank:2,you:false}],yourRank:1,participants:2},
    {rows:[{alias:"Alpha",points:2,answered:2,rank:1,you:true},{alias:"Beta",points:1,answered:1,rank:3,you:false},{alias:"Gamma",points:1,answered:1,rank:3,you:false}],yourRank:1,participants:3},
    {rows:[{alias:"Alpha",points:1,answered:1,rank:2,you:true}],yourRank:2,participants:1},
  ];
  for(const bad of invalid) expect(()=>readDailyStandings(bad)).toThrow(/Standings/);
});
it("requires a complete SQL standings page and its own row when participants fit",()=>{
  const noSelf={rows:[{alias:"Alpha",points:1,answered:1,rank:1,you:false},{alias:"Beta",points:0,answered:0,rank:2,you:false}],yourRank:1,participants:2};
  expect(()=>readDailyStandings(noSelf)).toThrow(/Standings/);
  expect(()=>readDailyStandings({...standing,rows:standing.rows.slice(0,1)})).toThrow(/Standings/);
  expect(()=>readDailyStandings({rows:[],yourRank:null,participants:1})).toThrow(/Standings/);
  expect(readDailyStandings({...noSelf,yourRank:null})).toEqual({...noSelf,yourRank:null});
});
it("retains valid ties and a truncated 100-row page without falsely requiring visible own row",()=>{
  const firstHundred=Array.from({length:100},(_,i)=>({
    alias:"Learner "+String(i).padStart(3,"0"),points:1,answered:1,rank:1,you:false,
  }));
  const tiedCutoff={rows:firstHundred,yourRank:1,participants:101};
  expect(readDailyStandings(tiedCutoff)).toEqual(tiedCutoff);
  const secondGroup={rows:firstHundred.map((row,i)=>i===99?{...row,points:0,answered:0,rank:2}:row),yourRank:2,participants:101};
  expect(readDailyStandings(secondGroup)).toEqual(secondGroup);
});

const cutoffRows = (cutoffPoints: number) => Array.from({length:100},(_,i)=>({
  alias:"Learner "+String(i).padStart(3,"0"),points:i===99?cutoffPoints:3,
  answered:3,rank:i===99?2:1,you:false,
}));
it("rejects an omitted caller outranking a truncated standings cutoff",()=>{
  expect(()=>readDailyStandings({rows:cutoffRows(0),yourRank:1,participants:101})).toThrow(/Standings/);
});
it("rejects omitted ranks requiring negative scores or more participants",()=>{
  expect(()=>readDailyStandings({rows:cutoffRows(0),yourRank:3,participants:101})).toThrow(/Standings/);
  expect(()=>readDailyStandings({rows:cutoffRows(2),yourRank:4,participants:101})).toThrow(/Standings/);
  expect(()=>readDailyStandings({rows:cutoffRows(1),yourRank:4,participants:110})).toThrow(/Standings/);
});
it("accepts feasible omitted ranks, null nonparticipant and a visible caller",()=>{
  const valid=[
    {rows:cutoffRows(0),yourRank:2,participants:101},
    {rows:cutoffRows(2),yourRank:3,participants:101},
    {rows:cutoffRows(2),yourRank:4,participants:102},
    {rows:cutoffRows(0),yourRank:null,participants:101},
    {rows:cutoffRows(0).map((row,i)=>i===0?{...row,you:true}:row),yourRank:1,participants:101},
  ];
  for(const value of valid) expect(readDailyStandings(value)).toEqual(value);
});
