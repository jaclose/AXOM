import { afterEach, expect, it, vi } from "vitest";
import type { NoctyriumState } from "../types";
import type { QuizSession } from "../quiz";
import type { DailyChallenge } from "./challenges";
const mock=vi.hoisted(()=>({state:{quizSessions:[]} as unknown as NoctyriumState,listener:undefined as undefined|((state:NoctyriumState)=>void),rpc:vi.fn(),flush:vi.fn(),assert:vi.fn()}));
vi.mock("../store",()=>({useStore:{getState:()=>mock.state,subscribe:(listener:(state:NoctyriumState)=>void)=>{mock.listener=listener;return()=>{mock.listener=undefined;};}}}));
vi.mock("../localVault",()=>({flushLocalVaultWrites:mock.flush,getVaultWriteCheckpoint:()=>0,assertVaultWritesSince:()=>{}}));
vi.mock("./accountScope",()=>({academicAccountScope:()=>({assertCurrent:mock.assert,dispose:()=>{}})}));
vi.mock("./client",()=>({academicClient:async()=>({rpc:mock.rpc})}));
import { observeChallengeRun } from "./challengeRun";
const challenge={id:"challenge"} as DailyChallenge;
const session=(id="run",mode:QuizSession["mode"]="exam")=>({id,mode,startedAt:"2026-10-13T12:00:01Z",questionIds:["local"],answers:[{questionId:"local",answerKey:"A"}]} as QuizSession);
const emit=(sessions:QuizSession[])=>{mock.state={...mock.state,quizSessions:sessions};mock.listener?.(mock.state);};
afterEach(()=>{mock.listener=undefined;mock.state={quizSessions:[]} as unknown as NoctyriumState;vi.resetAllMocks();});
it("sends canonical answer identity after durable save, never a client score, once per run",async()=>{
  mock.rpc.mockResolvedValue({data:{accepted:true},error:null});
  const report=vi.fn();const stop=observeChallengeRun("account",challenge,new Map([["local","bank:q"]]),"2026-10-13T12:00:00Z",report,()=>{});
  emit([session()]);await vi.waitFor(()=>expect(report).toHaveBeenCalledWith(expect.stringContaining("1 answers checked")));
  expect(mock.flush).toHaveBeenCalledOnce();expect(mock.rpc).toHaveBeenCalledOnce();
  expect(mock.rpc.mock.calls[0][1]).toEqual({challenge:"challenge",question_key:"bank:q",answer_key:"A",assisted:false,event_id:expect.stringMatching(/^[a-f0-9-]{36}$/)});
  emit([session()]);expect(mock.rpc).toHaveBeenCalledOnce();stop();
});
it("does not promote historical or failed offline events on refresh",async()=>{
  mock.state={quizSessions:[session("historical")]} as unknown as NoctyriumState;
  mock.rpc.mockResolvedValue({data:null,error:{message:"offline"}});
  const report=vi.fn();const stop=observeChallengeRun("account",challenge,new Map([["local","bank:q"]]),"2026-10-13T12:00:00Z",report,()=>{});
  emit([session("historical")]);expect(mock.rpc).not.toHaveBeenCalled();
  emit([session("live"),session("historical")]);await vi.waitFor(()=>expect(report).toHaveBeenCalledWith(expect.stringContaining("could not be confirmed")));
  emit([...mock.state.quizSessions]);expect(mock.rpc).toHaveBeenCalledOnce();stop();
});
it("holds events when local persistence fails and labels assisted attempts",async()=>{
  mock.flush.mockRejectedValueOnce(new Error("Local save failed"));mock.rpc.mockResolvedValue({data:{accepted:true},error:null});
  const report=vi.fn();const stop=observeChallengeRun("account",challenge,new Map([["local","bank:q"]]),"2026-10-13T12:00:00Z",report,()=>{});
  emit([session()]);await vi.waitFor(()=>expect(report).toHaveBeenCalledWith("Local save failed"));expect(mock.rpc).not.toHaveBeenCalled();
  emit([session("tutor","tutor"),session()]);await vi.waitFor(()=>expect(mock.rpc).toHaveBeenCalledOnce());
  expect(mock.rpc.mock.calls[0][1].assisted).toBe(true);stop();
});
