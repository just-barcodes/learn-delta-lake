import { expect, test, type Page } from "@playwright/test";

/** Read the numeric value of a stat card by its label. */
async function stat(page: Page, label: string): Promise<number> {
  const card = page.locator(".stat", { hasText: label });
  return Number(await card.locator(".stat__value").innerText());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".header__title")).toHaveText("Inside a Delta Lake Table");
});

test("append commits a version and grows the live-row count", async ({ page }) => {
  expect(await stat(page, "live rows")).toBe(6);
  expect(await stat(page, "versions")).toBe(1);
  await page.locator(".append__main").click();
  await expect(page.locator(".view-badge__value")).toHaveText("v1");
  expect(await stat(page, "live rows")).toBe(12);
  expect(await stat(page, "versions")).toBe(2);
});

test("time travel views an old version and jumps back to current", async ({ page }) => {
  await page.locator(".append__main").click();
  await expect(page.locator(".view-badge__value")).toHaveText("v1");

  await page.locator(".node--version", { hasText: "v0" }).click();
  await expect(page.locator(".view-badge__label")).toHaveText("TIME TRAVEL");
  await expect(page.locator(".view-badge__value")).toHaveText("v0");

  await page.locator(".view-badge__jump").click();
  await expect(page.locator(".view-badge__value")).toHaveText("v1");
});

test("inspecting a data file opens the grid and Escape closes it", async ({ page }) => {
  await page.locator(".node--data", { hasText: "d1.parquet" }).click();
  const modal = page.locator(".modal-panel");
  await expect(modal).toBeVisible();
  await expect(modal.locator(".modal-head__title")).toHaveText("d1.parquet");
  await expect(modal.locator(".grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("a commit inspector shows the delta actions as JSON", async ({ page }) => {
  // v0 is selected on load, so one click opens its inspector.
  await page.locator(".node--version", { hasText: "v0" }).click();
  const modal = page.locator(".modal-panel");
  await expect(modal.locator(".modal-head__title")).toHaveText(/0000\.json$/);
  await expect(modal.locator(".fact", { hasText: "operation" })).toContainText("append");
  await expect(modal.locator(".fact", { hasText: "adds" })).toContainText("2");
});

test("update rewrites rows without changing the row count", async ({ page }) => {
  await page.locator(".action", { hasText: "Update rows" }).click();
  const picker = page.locator(".picker__rows");
  await expect(picker).toBeVisible();
  await picker.locator(".picker__row").first().click();
  await page.locator(".picker__confirm.is-enabled").click();
  // UPDATE preserves the row count (unlike delete) and marks the row refunded.
  expect(await stat(page, "live rows")).toBe(6);
  await expect(page.locator(".whathappened__title")).toContainText("UPDATE");
});

test("copy-on-write delete drops rows without adding a deletion vector", async ({ page }) => {
  await page.locator(".action", { hasText: "Delete rows" }).click();
  const picker = page.locator(".picker__rows");
  await expect(picker).toBeVisible();
  await picker.locator(".picker__row").first().click();
  await page.locator(".picker__confirm.is-enabled").click();
  expect(await stat(page, "live rows")).toBe(5);
  // The tombstoned original file is still on disk, plus the rewritten survivor file.
  expect(await stat(page, "data files on disk")).toBe(3);
});

test("optimize bin-packs live files within each partition", async ({ page }) => {
  await page.locator(".append__main").click();
  expect(await stat(page, "live files")).toBe(3);
  await page.locator(".action", { hasText: "Optimize" }).click();
  await expect(page.locator(".view-badge__value")).toHaveText("v2");
  // d1+d2 (partition 2026-01) compact to one file; d3 (2026-02) is left untouched.
  expect(await stat(page, "live files")).toBe(2);
});

test("checkpoint writes a state snapshot without a new version", async ({ page }) => {
  await page.locator(".append__main").click();
  await expect(page.locator(".view-badge__value")).toHaveText("v1");
  await page.locator(".action", { hasText: "Checkpoint" }).click();
  await expect(page.locator(".view-badge__value")).toHaveText("v1"); // no new version
  expect(await stat(page, "checkpoints")).toBe(1);
  await expect(page.locator(".node--checkpoint").first()).toBeVisible();
});

test("simple level hides the actions column", async ({ page }) => {
  await expect(page.locator(".graph-col__head", { hasText: "Actions" })).toBeVisible();
  await page.locator(".segmented__btn", { hasText: "Simple" }).click();
  await expect(page.locator(".graph-col__head", { hasText: "Actions" })).toHaveCount(0);
});

test("schema evolution commits a new version and reads old files by column id", async ({
  page,
}) => {
  await page.locator(".segmented__btn", { hasText: "Advanced" }).click();
  // Add the region column: a metadata commit that bumps the version.
  await page.locator(".action--evolve").click();
  await expect(page.locator(".view-badge__value")).toHaveText("v1");
  expect(await stat(page, "schema version")).toBe(1);
  // The materialized table now has a region column; the original files predate it,
  // so their rows read back as null (schema-on-read by column id).
  await page.locator(".node--table").first().click();
  await expect(page.locator(".modal-panel .grid__th", { hasText: "region" })).toBeVisible();
  await expect(page.locator(".modal-panel .grid")).toContainText("null");
});

test("advanced deletion-vector delete masks rows and keeps the file", async ({ page }) => {
  await page.locator(".segmented__btn", { hasText: "Advanced" }).click();
  await page.locator(".delete-mode__btn", { hasText: "deletion vectors" }).click();
  await page.locator(".action", { hasText: "Delete rows" }).click();
  await page.locator(".picker__rows .picker__row").first().click();
  await page.locator(".picker__confirm.is-enabled").click();
  expect(await stat(page, "live rows")).toBe(5);
  expect(await stat(page, "deletion vectors")).toBe(1);
  // Data file is masked, not rewritten: still 2 files on disk.
  expect(await stat(page, "data files on disk")).toBe(2);
  await expect(page.locator(".node--dv").first()).toBeVisible();
});
