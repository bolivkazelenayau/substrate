import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";

const stage = (page: Page) => page.getByTestId("viewport-stage");

async function openPanel(page: Page, name: string) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openDisclosure(page: Page, name: string) {
  const button = page.locator("button.accordion-summary").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function waitForDisplay(page: Page, mode: string) {
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", "ready", { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "true", { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute("data-display-dislocation-mode", mode);
  await expect.poll(async () => Number(await stage(page).getAttribute("data-display-dislocation-regions"))).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => Number(await stage(page).getAttribute("data-display-dislocation-gap-rejections"))).toBeGreaterThan(0);
}

async function setRange(page: Page, label: string, value: number) {
  const input = page.locator("label.range").filter({ hasText: label }).locator('input[type="range"]');
  await input.fill(String(value));
}

async function circleSignature(page: Page) {
  return page.locator("#generated-artwork circle").evaluateAll((circles) => circles.map((circle) => [
    circle.getAttribute("cx"),
    circle.getAttribute("cy"),
    circle.getAttribute("r"),
    circle.getAttribute("opacity"),
  ].join(",")).join("|"));
}

async function attachStage(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await stage(page).screenshot(),
    contentType: "image/png",
  });
}

test("Display Dislocation visual, backend, export, and restoration gates", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Preset").selectOption("Display Dislocation");
  await openDisclosure(page, "Renderer-local controls");
  await openPanel(page, "Preview");
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await expect(stage(page)).toHaveAttribute("data-preview-backend", "svg-dom");
  await waitForDisplay(page, "horizontal-bands");

  const toggle = page.getByTestId("display-dislocation-enabled");
  await toggle.uncheck();
  await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "false");
  const baseSignature = await circleSignature(page);
  expect(baseSignature.length).toBeGreaterThan(0);
  await attachStage(page, testInfo, "01-base-dot-matrix");

  await toggle.check();
  await waitForDisplay(page, "horizontal-bands");
  const horizontalSignature = await circleSignature(page);
  expect(horizontalSignature).not.toBe(baseSignature);
  await expect(page.locator("#generated-artwork path")).toHaveCount(0);
  await expect(page.locator("#generated-artwork")).not.toHaveAttribute("mask", /.+/);
  await attachStage(page, testInfo, "02-local-horizontal-dislocation");

  await page.getByTestId("display-dislocation-mode").selectOption("blocks");
  await waitForDisplay(page, "blocks");
  const blockSignature = await circleSignature(page);
  expect(blockSignature).not.toBe(horizontalSignature);
  await attachStage(page, testInfo, "03-local-block-dislocation");

  const emitterSummary = page.locator("button.accordion-summary").filter({ hasText: "Emitters" });
  if ((await emitterSummary.getAttribute("aria-expanded")) !== "true") await emitterSummary.click();
  await setRange(page, "Emitter X", 760);
  await expect.poll(circleSignature.bind(null, page)).not.toBe(blockSignature);
  await attachStage(page, testInfo, "04-shifted-emitter");

  const beforeRadius = await circleSignature(page);
  await setRange(page, "Display response radius", 420);
  await expect.poll(circleSignature.bind(null, page)).not.toBe(beforeRadius);
  await attachStage(page, testInfo, "05-expanded-response-radius");

  const svgSignature = await circleSignature(page);
  const authoritativeCount = Number(await stage(page).getAttribute("data-renderer-element-count"));
  expect(await page.locator("#generated-artwork circle").count()).toBe(authoritativeCount);
  await openPanel(page, "Preview");
  await page.getByLabel("Preview Mode").selectOption("canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("data-renderer-element-count", String(authoritativeCount));
  await attachStage(page, testInfo, "06-canvas-parity");
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await expect.poll(circleSignature.bind(null, page)).toBe(svgSignature);

  await openPanel(page, "Export");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export SVG/ }).click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  if (!exportPath) throw new Error("Export download path was unavailable.");
  const exportedSvg = readFileSync(exportPath, "utf8");
  const artwork = exportedSvg.match(/<g id="generated-artwork"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? "";
  expect(artwork.match(/<circle\b/g)?.length ?? 0).toBe(authoritativeCount);
  expect(artwork).not.toMatch(/<path\b|<image\b|<foreignObject\b/);
  await attachStage(page, testInfo, "07-export-parity");

  await toggle.uncheck();
  await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "false");
  await expect.poll(circleSignature.bind(null, page)).toBe(baseSignature);
  await attachStage(page, testInfo, "08-exact-base-restoration");
});
