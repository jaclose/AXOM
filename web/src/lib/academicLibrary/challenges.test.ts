import { expect,it } from "vitest";
import { matchChallengeQuestions,type DailyChallenge } from "./challenges";
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
