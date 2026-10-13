import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { completeSetup, deferPromisePrompt, expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import type { NoctyriumState } from "../src/lib/types";
const file=process.env.AXOM_CHALLENGE_FIXTURE;
test.skip(!file,"Prepare the isolated local challenge fixture first.");
test.use({trace:"off",screenshot:"off",video:"off"});
test("two learners complete the same real daily pool and receive independent verified standings",async({page,browser,baseURL})=>{
  test.setTimeout(180_000); page.setDefaultTimeout(20_000);
  const fixture=JSON.parse(readFileSync(file!,"utf8"));
  const url=new URL(fixture.apiUrl);
  if(url.protocol!=="http:" || !["localhost","127.0.0.1"].includes(url.hostname)) throw new Error("This acceptance refuses hosted services.");
  const errors:string[]=[];
  const submits:Array<Record<string,unknown>>=[];
  page.on("request",request=>{ if(new URL(request.url()).pathname.endsWith("/rpc/academic_submit_challenge")) submits.push(request.postDataJSON()); });
  const other=await browser.newContext({reducedMotion:"reduce",viewport:{width:1440,height:900}});
  const second=await other.newPage(); second.setDefaultTimeout(20_000);
  const progress=(target:Page)=>target.evaluate(async()=>{
    const dev=await(window as unknown as {__AXOM_DEV__:Promise<{useStore:{getState:()=>NoctyriumState};flushVault:()=>Promise<void>}>}).__AXOM_DEV__;
    await dev.flushVault(); const s=dev.useStore.getState();
    return {questions:s.questions.length,attempts:s.questions.flatMap(q=>q.attempts).length};
  });
  async function prepare(target:Page,user:{email:string;password:string;alias:string}){
    target.on("pageerror",e=>errors.push(e.message));
    target.on("console",m=>{if(["warning","error"].includes(m.type())) errors.push(m.text());});
    await target.addInitScript(({url,key})=>{Object.assign(window,{__AXOM_E2E_ACCOUNT__:{url,key}});},{url:url.href,key:fixture.anonKey});
    await target.goto(`${baseURL}/#dashboard`);
    await completeSetup(target,user.alias); await deferPromisePrompt(target);
    await target.getByTitle("Account and protection").click();
    const panel=target.getByRole("dialog");
    await panel.getByLabel("Email",{exact:true}).fill(user.email); await panel.getByLabel(/^Password/).fill(user.password);
    await panel.getByRole("button",{name:"Sign in",exact:true}).click();
    await expect(panel.getByRole("button",{name:"Sign out"})).toBeVisible();
    await panel.getByRole("button",{name:"Done",exact:true}).click();
    await target.goto(`${baseURL}/?course-library=1&course=remote:${fixture.collection}#tracker`);
    await expect(target.getByRole("region",{name:"FTM 1 course plan"})).toBeVisible();
    await target.getByRole("button",{name:"Load Course",exact:true}).click();
    await expect(target.getByText("Course downloaded and enrollment saved to your account.",{exact:true})).toBeVisible();
    expect((await progress(target)).attempts).toBe(0);
    await target.goto(`${baseURL}/#leaderboards`);
    await target.getByRole("combobox",{name:"Module",exact:true}).selectOption(fixture.challenge);
    await target.getByLabel("Display alias",{exact:true}).fill(user.alias);
    await target.getByRole("button",{name:/^(Participate today|Save alias)$/}).click();
    await expect(target.getByRole("button",{name:"Start daily challenge",exact:true})).toBeEnabled();
  }
  async function complete(target:Page){
    await target.getByRole("button",{name:"Start daily challenge",exact:true}).click();
    let images=0;
    for(let i=0;i<fixture.questionCount;i++){
      await expect(target.getByRole("heading",{name:`Question ${i+1} of ${fixture.questionCount}`,exact:true})).toBeAttached();
      if(await target.locator(".tutor-question-region figure").count()){
        const image=target.locator(".tutor-question-region img").first();
        await expect.poll(()=>image.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);images++;
      }
      await target.getByLabel("Question stem",{exact:true}).focus();await target.keyboard.press("A");
      await target.getByRole("button",{name:i+1===fixture.questionCount?"Submit & finish":"Submit & next",exact:true}).click();
    }
    expect(images).toBeGreaterThan(0);
    await target.getByRole("dialog",{name:"Block results",exact:true}).getByRole("button",{name:"Done",exact:true}).click();
    await expect(target.getByRole("status").filter({hasText:`${fixture.questionCount} answers checked by the server.`})).toBeVisible();
    expect((await progress(target)).attempts).toBe(fixture.questionCount);
  }
  try{
    await prepare(page,fixture.users[0]);await prepare(second,fixture.users[1]);
    await complete(page);
    expect((await progress(second)).attempts).toBe(0);
    const own=page.locator(".daily-board-you");await expect(own).toContainText("Daily Alpha");
    await expect.poll(async()=>Number(await own.locator("td").nth(1).innerText())).toBeGreaterThan(0);
    const firstPoints=Number(await own.locator("td").nth(1).innerText());
    const client=createClient(url.href,fixture.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
    expect((await client.auth.signInWithPassword({email:fixture.users[0].email,password:fixture.users[0].password})).error).toBeNull();
    const replay=await client.rpc("academic_submit_challenge",submits[0]);expect(replay.error).toBeNull();expect(replay.data.replayed).toBe(true);
    const repeated=await client.rpc("academic_submit_challenge",{...submits[0],event_id:crypto.randomUUID()});expect(repeated.error).toBeNull();expect(repeated.data).toMatchObject({accepted:false,points:0});
    await complete(second);
    await page.locator(".daily-board").getByRole("button",{name:"Refresh",exact:true}).click();
    await expect(page.locator(".daily-board tbody tr")).toHaveCount(2);
    await expect.poll(()=>page.locator(".daily-board tbody tr td:first-child").allTextContents()).toEqual(["1","1"]);
    expect(Number(await page.locator(".daily-board-you td").nth(1).innerText())).toBe(firstPoints);
    for(const [width,height] of [[1440,900],[390,844],[1024,540]]){
      await page.setViewportSize({width,height});
      for(const theme of ["light","dark"]){
        await page.locator("html").evaluate((el,theme)=>el.setAttribute("data-theme",theme),theme);
        await page.locator(".daily-board").scrollIntoViewIfNeeded();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        if(process.env.AXOM_CHALLENGE_SCREENSHOTS) await page.screenshot({path:`/tmp/axom-daily-${width}-${height}-${theme}.png`});
        const alias=page.getByLabel("Display alias",{exact:true});
        await alias.scrollIntoViewIfNeeded(); await alias.focus(); await page.keyboard.press("Tab");
        await expect(page.getByRole("button",{name:"Save alias",exact:true})).toBeFocused();
        const start=page.getByRole("button",{name:"Start daily challenge",exact:true});
        await start.scrollIntoViewIfNeeded(); await expect(start).toBeInViewport();
        if(process.env.AXOM_CHALLENGE_SCREENSHOTS) await page.screenshot({path:`/tmp/axom-daily-controls-${width}-${height}-${theme}.png`});
      }
    }
    await page.setViewportSize({width:1440,height:900});await page.locator("html").evaluate(el=>el.style.zoom="2");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator("html").evaluate(el=>el.style.zoom="1");
    await second.getByRole("button",{name:"Hide my participation",exact:true}).click();
    await expect(second.getByRole("status").filter({hasText:"You are hidden"})).toBeVisible();
    await page.locator(".daily-board").getByRole("button",{name:"Refresh",exact:true}).click();await expect(page.locator(".daily-board tbody tr")).toHaveCount(1);
    expect((await progress(second)).attempts).toBe(fixture.questionCount);
    await page.reload();await page.getByRole("combobox",{name:"Module",exact:true}).selectOption(fixture.challenge);
    await expect(page.locator(".daily-board-you")).toContainText("Daily Alpha");
    expect((await progress(page)).attempts).toBe(fixture.questionCount);
    expect(errors).toEqual([]);
    if(process.env.AXOM_CHALLENGE_EVIDENCE){const bytes=submits.map(body=>Buffer.byteLength(JSON.stringify(body)));writeFileSync(process.env.AXOM_CHALLENGE_EVIDENCE,JSON.stringify({environment:"loopback",apiUrl:url.href,questions:fixture.questionCount,participants:2,tiedPoints:firstPoints,attemptRequests:bytes.length,attemptPayloadBytes:{minimum:Math.min(...bytes),maximum:Math.max(...bytes),total:bytes.reduce((a,b)=>a+b,0)}},null,2));}
  }finally{await other.close();}
});
