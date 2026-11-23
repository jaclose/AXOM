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
