import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const fontFixture = resolve("tests/fixtures/Basic-Regular.ttf");
const evidenceDirectory = resolve("e2e-artifacts/semantic-ui-alignment/after");
const stage = (page: Page) => page.getByTestId("viewport-stage");

mkdirSync(evidenceDirectory, { recursive: true });

async function openPanel(page: Page, name: string) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: name });
  await expect(button).toHaveCount(1);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openDisclosure(page: Page, name: string) {
  const button = page.locator("button.accordion-summary").filter({ hasText: name });
  await expect(button).toHaveCount(1);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function waitForReady(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", /^(ready|not-required)$/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled({ timeout: 60_000 });
}

async function loadFont(page: Page) {
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(fontFixture);
  await expect(page.getByTestId("project-message")).toContainText("loaded", { timeout: 60_000 });
  await waitForReady(page);
}

async function capture(page: Page, name: string, focusSelector?: string) {
  if (focusSelector) {
    await page.locator(focusSelector).scrollIntoViewIfNeeded();
  } else {
    await page.locator(".controls").evaluate((node) => { node.scrollTop = 0; });
  }
  await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`) });
}

test.describe("Semantic UI Alignment", () => {
  test("reflects the pipeline order and complete ownership without duplicate primary controls", async ({ page }) => {
    await page.goto("/");
    await waitForReady(page);

    await expect(page.locator("[data-stage]")).toHaveCount(8);
    await expect(page.locator("[data-stage]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-stage")))).resolves.toEqual([
      "typography", "field", "emitters", "glyph-geometry", "renderer", "mark-response", "appearance", "preview-export",
    ]);
    await expect(page.getByText("Advanced Parameters", { exact: true })).toHaveCount(0);

    await page.getByLabel("Preset").selectOption("Sonic Diffuser");
    await waitForReady(page);
    await openDisclosure(page, "Emitter Micro Response");
    await expect(page.getByTestId("emitter-micro-occupancy")).toHaveCount(1);
    await expect(page.getByTestId("emitter-micro-occupancy-enabled")).toHaveCount(0);
    await expect(page.getByTestId("emitter-micro-occupancy").locator("xpath=ancestor::section[@data-stage]")).toHaveAttribute("data-stage", "mark-response");

    await openDisclosure(page, "Emitters");
    await expect(page.locator('[data-owner="Emitter source and field definition"]')).toHaveCount(1);
    await expect(page.getByTestId("emitter-display-response").locator("xpath=ancestor::section[@data-stage]")).toHaveAttribute("data-stage", "mark-response");
    await expect(page.getByTestId("emitter-display-response").locator("xpath=ancestor::div[contains(@class, 'emitter-editor')]")).toHaveCount(0);

    await openDisclosure(page, "Field detail");
    await expect(page.getByTestId("field-advanced-controls").locator("xpath=ancestor::section[@data-stage]")).toHaveAttribute("data-stage", "field");
    await expect(page.getByTestId("field-advanced-controls")).toContainText("Emitter blend");
    await openDisclosure(page, "Renderer detail");
    await expect(page.getByTestId("renderer-advanced-controls")).toContainText("Renderer safety");
  });

  test("presents inactive and unsupported retained systems truthfully and preserves disclosure state", async ({ page }) => {
    await page.goto("/");
    await openDisclosure(page, "Glyph Micro Warp");
    await expect(page.getByTestId("glyph-micro-warp-enabled")).toBeDisabled();
    await expect(page.locator(".glyph-micro-warp-section")).toContainText("unavailable");

    await page.getByLabel("Preset").selectOption("Display Dislocation");
    await waitForReady(page);
    await openDisclosure(page, "Renderer detail");
    await openDisclosure(page, "Renderer-local controls");
    await openPanel(page, "Preview");
    await openPanel(page, "Export");
    await page.getByRole("button", { name: "SDF Contours", exact: true }).click();
    await waitForReady(page);

    await expect(page.getByTestId("renderer-detail")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('[data-testid="renderer-local-controls"] > button')).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("button.panel-heading-button").filter({ hasText: "Preview" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("button.panel-heading-button").filter({ hasText: "Export" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("display-dislocation-enabled")).toBeDisabled();
    await expect(page.getByTestId("display-dislocation-enabled")).toHaveAttribute("data-project-enabled", "true");
    await expect(page.getByTestId("display-dislocation-controls")).toContainText("Retained but inactive");
    await expect(page.getByTestId("display-dislocation-controls")).toContainText("unavailable");
  });

  test("runs the default-to-export authoring workflow without losing stage context", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForReady(page);
    await page.getByLabel("Preset").selectOption("Calm Current");
    await waitForReady(page);
    await loadFont(page);
    await openDisclosure(page, "Calm Water");
    await page.getByTestId("glyph-calm-water-strength").fill("19");
    await page.getByLabel("Text substrate").fill("LATE\nTYPE");
    await waitForReady(page);

    await page.getByRole("button", { name: "Glyph Diffuser", exact: true }).click();
    await waitForReady(page);
    await openDisclosure(page, "Emitters");
    await page.getByLabel("Source mode").selectOption("custom");
    await page.locator('input[aria-label="Emitter X"]').fill("500");
    await waitForReady(page);

    await openDisclosure(page, "Glyph Micro Warp");
    const warp = page.getByTestId("glyph-micro-warp-enabled");
    if (await warp.isEnabled() && !(await warp.isChecked())) await warp.check();
    await openDisclosure(page, "Glyph Fragmentation");
    await page.getByLabel("Preset").selectOption("Fragment Matrix");
    await waitForReady(page);
    await openDisclosure(page, "Renderer-local controls");
    const display = page.getByTestId("display-dislocation-enabled");
    const fragmentation = page.getByTestId("glyph-displacement-enabled");
    if (await display.isEnabled() && !(await display.isChecked())) await display.check();
    await expect(fragmentation).not.toBeChecked();
    if (await fragmentation.isEnabled()) await fragmentation.check();
    await expect(display).not.toBeChecked();

    await openDisclosure(page, "Emitter Micro Response");
    const micro = page.getByTestId("emitter-micro-enabled");
    if (!(await micro.isChecked())) await micro.check();
    await page.getByTestId("emitter-micro-occupancy").selectOption("disperse-exterior");
    await waitForReady(page);

    await openPanel(page, "Preview");
    await page.getByLabel("Preview Mode").selectOption("canvas-2d");
    await expect(page.getByTestId("artwork-canvas")).toBeVisible();
    await page.getByLabel("Preview Mode").selectOption("svg-dom");
    await waitForReady(page);

    await openPanel(page, "Export");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export SVG/ }).click();
    const download = await downloadPromise;
    expect(await download.path()).toBeTruthy();
    await expect(stage(page)).toHaveAttribute("data-substrate-phase", "ready");
  });

  test("captures aligned desktop evidence at 1280×800 and 1440×900", async ({ page }) => {
    for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      await page.goto("/");
      await waitForReady(page);
      const metrics = await page.locator(".controls").evaluate((node) => ({
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      }));
      expect(metrics.scrollHeight).toBeLessThan(3500);
      await capture(page, `default-${size.width}x${size.height}`);
    }
  });

  test("captures deformation, mark-response, unsupported, and retained-state evidence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByLabel("Preset").selectOption("Fragment Matrix");
    await loadFont(page);
    await openDisclosure(page, "Glyph Micro Warp");
    await openDisclosure(page, "Calm Water");
    await openDisclosure(page, "Glyph Fragmentation");
    await capture(page, "glyph-deformation-1440x900", '[data-testid="glyph-displacement-controls"]');

    await page.goto("/");
    await page.getByLabel("Preset").selectOption("Sonic Halftone");
    await waitForReady(page);
    await openDisclosure(page, "Emitter Display Response");
    await openDisclosure(page, "Emitter Micro Response");
    await openDisclosure(page, "Glyph Falloff Field");
    await capture(page, "mark-response-1440x900", ".emitter-micro-response");

    await page.goto("/");
    await page.getByLabel("Preset").selectOption("Display Dislocation");
    await waitForReady(page);
    await openDisclosure(page, "Renderer-local controls");
    await page.getByRole("button", { name: "SDF Contours", exact: true }).click();
    await waitForReady(page);
    await capture(page, "unsupported-retained-1440x900", '[data-testid="display-dislocation-controls"]');

    await page.getByRole("button", { name: "SDF Halftone", exact: true }).click();
    await waitForReady(page);
    await openDisclosure(page, "Renderer-local controls");
    await openPanel(page, "Export");
    const savePromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save project" }).click();
    const save = await savePromise;
    const savedPath = await save.path();
    if (!savedPath) throw new Error("Project download path was unavailable.");
    const retainedProject = JSON.parse(readFileSync(savedPath, "utf8")) as Record<string, any>;
    retainedProject.renderer = "sdf-halftone";
    retainedProject.dotGrid = { ...retainedProject.dotGrid, enabled: true };
    retainedProject.displayDislocation = { ...retainedProject.displayDislocation, enabled: true };
    retainedProject.glyphDisplacement = { ...retainedProject.glyphDisplacement, enabled: true };
    const retainedPath = resolve(evidenceDirectory, "fragmentation-retained-display-active.substrate.json");
    writeFileSync(retainedPath, JSON.stringify(retainedProject, null, 2));
    await page.locator('input[type="file"][accept*="application/json"]').setInputFiles(retainedPath);
    await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(fontFixture);
    await expect(page.getByTestId("project-message")).toContainText("loaded", { timeout: 60_000 });
    await waitForReady(page);
    await openDisclosure(page, "Glyph Fragmentation");
    await openDisclosure(page, "Renderer-local controls");
    await expect(page.getByTestId("glyph-displacement-controls")).toContainText("retained / inactive");
    await expect(page.getByTestId("display-dislocation-controls")).toBeVisible();
    await capture(page, "fragmentation-retained-display-active-1440x900", '[data-testid="glyph-displacement-controls"]');
  });
});
