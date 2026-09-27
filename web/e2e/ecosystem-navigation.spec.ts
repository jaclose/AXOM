import { expect, test, type Page } from "@playwright/test";

test("Daily Games and Building remain honest and responsive", async ({ page }) => {
  const errors:string[]=[]; page.on("console",m=>{if(m.type()==="error")errors.push(m.text())}); page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/",{waitUntil:"networkidle"}); await completeOnboarding(page);
  for (const viewport of [{width:1280,height:900},{width:768,height:900},{width:430,height:880},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(()=>{window.location.hash="daily-games"});
    await expect(page.getByRole("heading",{level:1,name:"Daily Games"})).toBeVisible();
    await expect(page.getByRole("link",{name:/open verified site/i})).toHaveAttribute("href","https://doctordle.org/");
    await expect(page.getByText("DESTINATION REQUIRES CONFIRMATION")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.evaluate(()=>{window.location.hash="building"});
    await expect(page.getByRole("heading",{level:1,name:"Building AXOM"})).toBeVisible();
    await page.getByRole("tab",{name:"Systems"}).click();
    await expect(page.getByRole("heading",{name:"Accounts & Sync"})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  expect(errors).toEqual([]);
});

async function completeOnboarding(page:Page){
  const name=page.getByLabel("Display name (optional)"); if(!await name.isVisible().catch(()=>false))return;
  await name.fill("AXOM Ecosystem E2E"); for(let i=0;i<3;i++)await page.getByRole("button",{name:"Continue"}).click();
  await page.getByRole("button",{name:"Finish setup",exact:true}).click(); const later=page.getByRole("button",{name:"Review later"}); if(await later.count())await later.click();
}
