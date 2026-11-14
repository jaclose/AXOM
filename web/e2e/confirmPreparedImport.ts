import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** The private-library selector is read-only until the learner explicitly confirms. */
export async function confirmPreparedImport(page: Page): Promise<void> {
  const preview = page.getByRole("region", { name: "Review selected import", exact: true });
  await expect(preview).toBeVisible({ timeout: 90_000 });
  await expect(preview).toContainText("nothing saved yet");
  await preview.getByRole("button", { name: "Confirm installation on this device" }).click();
}
