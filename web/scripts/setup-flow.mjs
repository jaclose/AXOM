/**
 * First-run setup, as a new student walks it: name, then the defaults on
 * "How you study" and "Make it yours", then Enter AXOM. Shared by the e2e
 * specs and the release verification scripts so a copy change lands once.
 */
export const SETUP_NAME_LABEL = "What should we call you?";

/**
 * Walks setup with the default choices. With `ifVisible`, returns false
 * without doing anything when setup is not on screen (already onboarded).
 */
export async function completeSetup(page, name, { ifVisible = false } = {}) {
  const input = page.getByLabel(SETUP_NAME_LABEL, { exact: true });
  if (ifVisible && !(await input.isVisible().catch(() => false))) return false;
  await input.fill(name);
  for (let step = 0; step < 2; step += 1) await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Enter AXOM", exact: true }).click();
  return true;
}
