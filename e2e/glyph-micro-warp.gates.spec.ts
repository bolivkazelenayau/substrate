import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const legacyFixture = resolve("tests/fixtures/projects/legacy/private-sonics-v8.substrate.json");
const parsedFontFixture = resolve("tests/fixtures/Basic-Regular.ttf");
const screenshotDirectory = process.env.GLYPH_MICRO_SCREENSHOT_DIR;
const stage = (page: Page) => page.getByTestId("viewport-stage");

async function openPanel(page: Page, name: string) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openDisclosure(page: Page, name: string) {
  const button = page.locator("button.accordion-summary").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function waitForReady(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", "ready", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled({ timeout: 60_000 });
}

async function pinSvgPreview(page: Page) {
  await openPanel(page, "Preview");
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await expect(stage(page)).toHaveAttribute("data-preview-backend", "svg-dom");
}

async function loadPrivateSonics(page: Page) {
  await page.goto("/");
  await openPanel(page, "Export");
  await page.locator('input[type="file"][accept*="application/json"]').setInputFiles(legacyFixture);
  await expect(page.getByLabel("Text substrate")).toHaveValue("Private\nSonics");
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  await expect(page.getByTestId("project-message")).toContainText("loaded", { timeout: 60_000 });
  await waitForReady(page);
  await pinSvgPreview(page);
}

async function authoritativePaths(page: Page) {
  return page.locator("#substrate-mask path[data-glyph-index]").evaluateAll((paths) => paths.map((path) => ({
    d: path.getAttribute("d") ?? "",
    textIndex: Number(path.getAttribute("data-character-index")),
  })));
}

async function authoritativeSignature(page: Page) {
  return (await authoritativePaths(page)).map(({ textIndex, d }) => `${textIndex}:${d}`).join("|");
}

async function circleSignature(page: Page) {
  return page.locator("#generated-artwork > circle").evaluateAll((circles) => circles.map((circle) => [
    circle.getAttribute("cx"),
    circle.getAttribute("cy"),
    circle.getAttribute("r"),
    circle.getAttribute("opacity"),
  ].join(",")).join("|"));
}

async function domainSnapshot(page: Page) {
  return stage(page).evaluate((node) => ({
    microActive: node.getAttribute("data-glyph-micro-warp-active"),
    microKey: node.getAttribute("data-glyph-micro-warp-key") ?? "",
    microGeometryKey: node.getAttribute("data-glyph-micro-warp-geometry-key") ?? "",
    domainKey: node.getAttribute("data-glyph-domain-key") ?? "",
    rendererKey: node.getAttribute("data-renderer-key") ?? "",
    sceneKey: node.getAttribute("data-scene-layout-key") ?? "",
    substrateKey: node.getAttribute("data-substrate-key") ?? "",
    affected: Number(node.getAttribute("data-glyph-micro-warp-affected")),
    sourcePoints: Number(node.getAttribute("data-glyph-micro-warp-source-points")),
    warpedPoints: Number(node.getAttribute("data-glyph-micro-warp-points")),
    emitterCount: Number(node.getAttribute("data-glyph-micro-warp-emitters")),
    maxDisplacement: Number(node.getAttribute("data-glyph-micro-warp-max-displacement")),
    buildMs: Number(node.getAttribute("data-glyph-micro-warp-build-ms")),
    affectedBounds: node.getAttribute("data-glyph-micro-warp-affected-bounds") ?? "",
    safety: node.getAttribute("data-glyph-micro-warp-safety") ?? "",
    markMode: node.getAttribute("data-emitter-micro-mode") ?? "",
    markAdjusted: Number(node.getAttribute("data-emitter-micro-adjusted")),
  }));
}

async function setRange(page: Page, testId: string, value: number) {
  await page.getByTestId(testId).fill(String(value));
}

async function setMarkRange(page: Page, label: string, value: number) {
  const input = page.locator(".emitter-micro-response label.range")
    .filter({ hasText: label })
    .locator('input[type="range"]');
  await input.fill(String(value));
}

async function attachStage(page: Page, testInfo: TestInfo, name: string) {
  const body = await stage(page).screenshot();
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    writeFileSync(resolve(screenshotDirectory, `${name}.png`), body);
  }
}

async function saveProject(page: Page) {
  await openPanel(page, "Export");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Project download path was unavailable.");
  return { path, document: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> };
}

test("Glyph Micro Warp four-state outline, locality, parity, export, and legacy gates", async ({ page }, testInfo) => {
  await loadPrivateSonics(page);
  await expect(stage(page)).toHaveAttribute("data-glyph-micro-warp-active", "false");
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "disabled");
  await expect(stage(page)).toHaveAttribute("data-glyph-displacement-key", "disabled");
  const baselineSaved = await saveProject(page);
  const baselinePaths = await authoritativePaths(page);
  const baselineOutline = await authoritativeSignature(page);
  const baselineCircles = await circleSignature(page);
  const baselineDomain = await domainSnapshot(page);
  const baselineO = baselinePaths.find((path) => path.textIndex === 9)?.d;
  const baselineP = baselinePaths.find((path) => path.textIndex === 0)?.d;
  expect(baselineO?.length).toBeGreaterThan(0);
  expect(baselineP?.length).toBeGreaterThan(0);

  await openPanel(page, "Diagnostics");
  await page.getByLabel("Substrate view").selectOption("glyph-outlines");
  await attachStage(page, testInfo, "01-all-new-effects-disabled");

  await page.getByTestId("glyph-micro-warp-enabled").check();
  await setRange(page, "glyph-micro-warp-strength", 100);
  await setRange(page, "glyph-micro-warp-radius", 220);
  await setRange(page, "glyph-micro-warp-detail-scale", 12);
  await setRange(page, "glyph-micro-warp-normal", 100);
  await setRange(page, "glyph-micro-warp-tangent", 24);
  await setRange(page, "glyph-micro-warp-max", 30);
  await waitForReady(page);
  await expect(stage(page)).toHaveAttribute("data-glyph-micro-warp-active", "true");
  await expect.poll(async () => (await domainSnapshot(page)).affected).toBeGreaterThan(0);
  const warpOnlyPaths = await authoritativePaths(page);
  const warpOnlyOutline = await authoritativeSignature(page);
  const warpOnlyCircles = await circleSignature(page);
  const warpOnlyDomain = await domainSnapshot(page);
  const warpOnlyO = warpOnlyPaths.find((path) => path.textIndex === 9)?.d;
  const warpOnlyP = warpOnlyPaths.find((path) => path.textIndex === 0)?.d;
  expect(warpOnlyOutline).not.toBe(baselineOutline);
  expect(warpOnlyO).not.toBe(baselineO);
  expect(warpOnlyP).toBe(baselineP);
  expect(warpOnlyDomain.domainKey).not.toBe(baselineDomain.domainKey);
  expect(warpOnlyDomain.microGeometryKey).toBe(warpOnlyDomain.domainKey);
  expect(warpOnlyDomain.sourcePoints).toBeGreaterThan(0);
  expect(warpOnlyDomain.warpedPoints).toBeGreaterThan(0);
  expect(warpOnlyDomain.maxDisplacement).toBeGreaterThan(0);
  expect(["complete", "displacement-clamped", "topology-guarded"]).toContain(warpOnlyDomain.safety);
  const debugOutline = await page.locator(".debug-glyph-outlines path").evaluateAll((paths) => paths.map((path) => path.getAttribute("d") ?? "").join("|"));
  expect(debugOutline).toBe(warpOnlyPaths.map(({ d }) => d).join("|"));
  await attachStage(page, testInfo, "02-glyph-micro-warp-only");

  await page.getByTestId("glyph-micro-warp-enabled").uncheck();
  await expect.poll(authoritativeSignature.bind(null, page)).toBe(baselineOutline);
  await openDisclosure(page, "Emitter Micro Response");
  await page.getByTestId("emitter-micro-enabled").check();
  await setMarkRange(page, "Response radius", 300);
  await setMarkRange(page, "Position detail", 78);
  await setMarkRange(page, "Detail scale", 10);
  await setMarkRange(page, "Max displacement", 22);
  await waitForReady(page);
  await expect.poll(async () => (await domainSnapshot(page)).markAdjusted).toBeGreaterThan(0);
  const markOnlyOutline = await authoritativeSignature(page);
  const markOnlyCircles = await circleSignature(page);
  const markOnlyDomain = await domainSnapshot(page);
  expect(markOnlyOutline).toBe(baselineOutline);
  expect(markOnlyCircles).not.toBe(baselineCircles);
  expect(markOnlyDomain.microActive).toBe("false");
  expect(markOnlyDomain.domainKey).toBe(baselineDomain.domainKey);
  await attachStage(page, testInfo, "03-emitter-micro-response-only");

  await page.getByTestId("glyph-micro-warp-enabled").check();
  await waitForReady(page);
  await expect.poll(authoritativeSignature.bind(null, page)).toBe(warpOnlyOutline);
  await expect.poll(async () => (await domainSnapshot(page)).markAdjusted).toBeGreaterThan(0);
  const combinedCircles = await circleSignature(page);
  const combinedDomain = await domainSnapshot(page);
  expect(combinedDomain.microKey).toBe(warpOnlyDomain.microKey);
  expect(combinedDomain.domainKey).toBe(warpOnlyDomain.domainKey);
  expect(combinedCircles).not.toBe(markOnlyCircles);
  expect(combinedCircles).not.toBe(warpOnlyCircles);
  await attachStage(page, testInfo, "04-glyph-warp-plus-mark-response");
  if (screenshotDirectory) {
    writeFileSync(resolve(screenshotDirectory, "metrics.json"), JSON.stringify({
      baseline: baselineDomain,
      glyphMicroWarpOnly: warpOnlyDomain,
      emitterMicroResponseOnly: markOnlyDomain,
      combined: combinedDomain,
      outlineProof: {
        targetTextIndex: 9,
        targetChanged: warpOnlyO !== baselineO,
        distantTextIndex: 0,
        distantExact: warpOnlyP === baselineP,
        glyphPathCount: baselinePaths.length,
      },
    }, null, 2));
  }

  await page.getByTestId("emitter-micro-enabled").uncheck();
  const focusedMicroKey = (await domainSnapshot(page)).microKey;
  const focusedDomainKey = (await domainSnapshot(page)).domainKey;
  for (const renderer of ["SDF Halftone", "SDF Contours", "Wave Contours", "Glyph Diffuser"]) {
    await page.locator('[aria-label="Renderer"]').getByRole("button", { name: renderer, exact: true }).click();
    await waitForReady(page);
    const rendererDomain = await domainSnapshot(page);
    expect(rendererDomain.microKey, renderer).toBe(focusedMicroKey);
    expect(rendererDomain.domainKey, renderer).toBe(focusedDomainKey);
    expect(Number(await stage(page).getAttribute("data-renderer-element-count")), renderer).toBeGreaterThan(0);
  }

  const svgParity = await domainSnapshot(page);
  const svgParityOutline = await authoritativeSignature(page);
  await openPanel(page, "Preview");
  await page.getByLabel("Preview Mode").selectOption("canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  const canvasParity = await domainSnapshot(page);
  expect(canvasParity.microKey).toBe(svgParity.microKey);
  expect(canvasParity.domainKey).toBe(svgParity.domainKey);
  expect(canvasParity.rendererKey).toBe(svgParity.rendererKey);
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await expect.poll(authoritativeSignature.bind(null, page)).toBe(svgParityOutline);

  await openPanel(page, "Export");
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export SVG/ }).click();
  const exported = await exportPromise;
  const exportPath = await exported.path();
  if (!exportPath) throw new Error("SVG export download path was unavailable.");
  const exportedSvg = readFileSync(exportPath, "utf8");
  expect(exportedSvg).toContain(`d="${warpOnlyO}"`);
  expect(exportedSvg).toContain(svgParity.microKey);
  expect(exportedSvg).toContain("glyphMicroWarp");
  expect(exportedSvg).not.toMatch(/<image\b|<canvas\b|<foreignObject\b|data:image|;base64,/i);

  await openPanel(page, "Export");
  await page.locator('input[type="file"][accept*="application/json"]').setInputFiles(legacyFixture);
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  await waitForReady(page);
  await pinSvgPreview(page);
  await expect.poll(authoritativeSignature.bind(null, page)).toBe(baselineOutline);
  await expect.poll(circleSignature.bind(null, page)).toBe(baselineCircles);
  const restoredDomain = await domainSnapshot(page);
  expect(restoredDomain.domainKey).toBe(baselineDomain.domainKey);
  expect(restoredDomain.sceneKey).toBe(baselineDomain.sceneKey);
  const restoredSaved = await saveProject(page);
  expect(restoredSaved.document).toEqual(baselineSaved.document);
});

test("existing Fragmentation and Display Dislocation stay protected when Micro Warp is disabled", async ({ page }) => {
  await loadPrivateSonics(page);
  await page.getByLabel("Preset").selectOption("Fragment Matrix");
  await waitForReady(page);
  await expect(stage(page)).toHaveAttribute("data-glyph-micro-warp-active", "false");
  await expect(stage(page)).toHaveAttribute("data-glyph-displacement-mode", "grid");
  await expect.poll(async () => Number(await stage(page).getAttribute("data-glyph-fragment-count"))).toBeGreaterThan(0);

  await page.getByLabel("Preset").selectOption("Display Dislocation");
  await waitForReady(page);
  await expect(stage(page)).toHaveAttribute("data-glyph-micro-warp-active", "false");
  await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "true");
  await expect.poll(async () => Number(await stage(page).getAttribute("data-display-dislocation-candidates"))).toBeGreaterThan(0);
});
