/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, test, type Page } from "@playwright/test";

// The construction demo, end to end against the real offline API: reset,
// the requirement register, evidence, then loading Inspection Procedure
// Revision B and seeing what changed. It resets the local demo first.

async function demoAction(page: Page, action: "reset" | "sync", done: RegExp) {
  const header = page.getByRole("banner");
  if (action === "reset") {
    await header.getByTestId("reset-demo").click();
    await header.getByTestId("confirm-reset").click(); // a reset is always confirmed
  } else {
    await header.getByTestId("simulate-sync").click();
  }
  await expect(page.getByTestId("demo-progress")).toBeVisible();
  await expect(header.getByTestId("demo-status")).toHaveText(done, { timeout: 180_000 });
}

async function openEvidence(page: Page, trigger: ReturnType<Page["getByTestId"]>) {
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Evidence" });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("the construction demo, from reset to a superseding revision", async ({ page }) => {
  await page.goto("/");
  // Demo sign-in: the Commercial Manager may read all three documents.
  await page.getByTestId("sign-in-commercial-manager").click();
  await expect(page.getByTestId("identity-name")).toHaveText("Commercial Manager");
  await demoAction(page, "reset", /Local demo reset/);
  await expect(page.getByTestId("replay-label").first()).toContainText("authored fixtures, not live AI");

  // Project -> requirement register at Rev A
  await page.getByTestId("project-card").filter({ hasText: "Kestrel Yard Depot Extension" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kestrel Yard Depot Extension (fictional)");
  await expect(page.getByTestId("document-row")).toHaveCount(3); // Rev A and Rev B are revisions of one document
  const notice = page.getByTestId("requirement").filter({ hasText: "48 hours' notice" });
  await expect(notice).toHaveCount(1);
  await expect(notice).toHaveAttribute("data-current", "true");
  await expect(notice.getByTestId("requirement-role")).toHaveText("Contractor");
  await expect(notice.getByTestId("requirement-deadline")).toHaveText("48 hours' notice");
  await expect(notice.getByTestId("requirement-source")).toContainText("Rev A");

  // A requirement that states no role or deadline shows "Not stated"
  const helmets = page.getByTestId("requirement").filter({ hasText: "helmets" });
  await expect(helmets.getByTestId("requirement-deadline")).toHaveText("Not stated");

  // Exact evidence
  const drawer = await openEvidence(page, notice.getByRole("button", { name: "Source quote" }));
  await expect(drawer.getByTestId("evidence-quote").first()).toContainText("48 hours' notice");
  await expect(drawer.getByTestId("evidence-locator").first()).toHaveText(/^Page \d+$/);
  await page.keyboard.press("Escape");

  // Load Rev B -> Revisions
  await demoAction(page, "sync", /Loaded a new document revision/);
  await page.goto("/changes");
  const change = page.getByTestId("change").filter({ hasText: "Inspection Procedure" });
  await expect(change.getByTestId("change-versions")).toHaveText("Rev A → Rev B");
  await expect(change.getByTestId("supersession")).toContainText("supersedes Revision A");
  const changed = change.getByTestId("affected-requirement_changed");
  await expect(changed).toHaveCount(1);
  await expect(changed.getByTestId("requirement-before")).toContainText("48 hours' notice");
  await expect(changed.getByTestId("requirement-after")).toContainText("72 hours' notice");

  // The project keeps Rev A's requirement as superseded history
  await page.getByRole("link", { name: "Projects" }).first().click();
  await page.getByTestId("project-card").first().click();
  await expect(page.getByTestId("requirement").filter({ hasText: "72 hours' notice" })).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("requirement").filter({ hasText: "48 hours' notice" })).toHaveAttribute("data-current", "false");
});
