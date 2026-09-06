import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const stage = (page: Page) => page.getByTestId("viewport-stage");
const evidenceDirectory = resolve("e2e-artifacts/parameter-quality");
mkdirSync(evidenceDirectory, { recursive: true });

async function openPanel(page: Page, name: string) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openDisclosure(page: Page, name: string) {
  const button = page.locator("button.accordion-summary").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function waitForReady(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", /^(ready|not-required)$/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled({ timeout: 60_000 });
}

async function saveDocument(page: Page) {
  await openPanel(page, "Export");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Project download path was unavailable.");
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

async function editNumericValue(page: Page, label: string, value: string) {
  const range = page.locator("label.range").filter({ hasText: label }).first();
  await range.locator("output").dblclick();
  const editor = range.locator("input.range-value-edit");
  await editor.fill(value);
  await editor.press("Enter");
}

test.describe("Parameter quality / interaction", () => {
  test("supports exact entry, reset, modifier tuning, mapped frequency, and desktop evidence", async ({ page }) => {
    for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      await page.goto("/");
      await waitForReady(page);
      await page.getByLabel("Preset").selectOption("Sonic Diffuser");
      await waitForReady(page);
      await openDisclosure(page, "Emitters");

      const strength = page.locator('input[type="range"][aria-label="Strength"]').first();
      await strength.fill("2.4");
      await waitForReady(page);
      await expect(page.getByRole("button", { name: /Reset Strength/ })).toBeVisible();
      await page.getByRole("button", { name: /Reset Strength/ }).click();
      await waitForReady(page);

      const wave = page.locator('input[type="range"][data-parameter="emitters.wave-frequency"]');
      await expect(wave).toHaveAttribute("min", "0");
      await expect(wave).toHaveAttribute("max", "100");
      await editNumericValue(page, "Wave frequency", "0.035");
      await waitForReady(page);
      await expect(wave).toHaveAttribute("aria-valuetext", /0\.035/);

      await editNumericValue(page, "Phase", "90");
      await waitForReady(page);
      await expect(page.locator('input[type="range"][aria-label="Phase"]').first()).toHaveAttribute("aria-valuetext", /90/);

      const beforeKeyboard = Number(await strength.inputValue());
      await strength.focus();
      await strength.press("Shift+ArrowRight");
      await waitForReady(page);
      expect(Number(await strength.inputValue())).toBeGreaterThan(beforeKeyboard);

      await page.screenshot({ path: resolve(evidenceDirectory, `controls-${size.width}x${size.height}.png`), fullPage: false });
    }
  });

  test("retains and truthfully exposes an imported value outside the normal slider band", async ({ page }) => {
    await page.goto("/");
    await waitForReady(page);
    const document = await saveDocument(page);
    document.renderer = "sdf-halftone";
    document.emitter = { ...document.emitter, enabled: true };
    document.emitterMicroResponse = {
      ...document.emitterMicroResponse,
      enabled: true,
      responseRadius: 1800,
    };
    const retainedPath = resolve(evidenceDirectory, "retained-response-radius.substrate.json");
    writeFileSync(retainedPath, JSON.stringify(document, null, 2));

    await page.locator('input[type="file"][accept*="application/json"]').setInputFiles(retainedPath);
    await waitForReady(page);
    await openDisclosure(page, "Emitter Micro Response");
    const retained = page.locator('label.range[data-parameter="mark-response.emitter-micro.response-radius"]');
    await expect(retained).toHaveAttribute("data-out-of-soft-range", "true");
    await expect(retained.locator("output")).toContainText("1800");

    await editNumericValue(page, "Response radius", "1750");
    await waitForReady(page);
    const after = await saveDocument(page);
    expect(after.emitterMicroResponse.responseRadius).toBe(1750);
  });
});
