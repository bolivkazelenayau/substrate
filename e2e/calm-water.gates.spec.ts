import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const parsedFontFixture = resolve("tests/fixtures/Basic-Regular.ttf");
const privateSonicsFixture = resolve("tests/fixtures/projects/legacy/private-sonics-v8.substrate.json");
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

async function loadPreset(page: Page, preset: "Calm Current" | "Tidal Slice") {
  await page.goto("/");
  await page.getByLabel("Preset").selectOption(preset);
  const pause = page.getByRole("button", { name: "Pause animation" });
  if (await pause.count()) await pause.click();
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  await openPanel(page, "Preview");
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await waitForReady(page);
  await openDisclosure(page, "Glyph Influence");
  await openDisclosure(page, "Calm Water");
  await openDisclosure(page, "Glyph Fragmentation");
  await openDisclosure(page, "Emitter Micro Response");
}

async function loadPrivateSonics(page: Page) {
  await page.goto("/");
  await openPanel(page, "Export");
  await page.locator('input[type="file"][accept*="application/json"]').setInputFiles(privateSonicsFixture);
  await expect(page.getByLabel("Text substrate")).toHaveValue("Private\nSonics");
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  await openPanel(page, "Preview");
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await waitForReady(page);
  await openDisclosure(page, "Glyph Influence");
  await openDisclosure(page, "Calm Water");
  await openDisclosure(page, "Glyph Fragmentation");
}

async function authoritativeGlyphs(page: Page) {
  return page.locator("#substrate-mask path[data-glyph-id]").evaluateAll((paths) => paths.map((path) => ({
    glyphId: path.getAttribute("data-glyph-id") ?? "",
    textIndex: Number(path.getAttribute("data-character-index")),
    lineIndex: Number(path.getAttribute("data-line-index")),
    glyphIndexInLine: Number(path.getAttribute("data-glyph-index-in-line")),
    d: path.getAttribute("d") ?? "",
  })));
}

async function changedGlyphs(page: Page) {
  return stage(page).evaluate((node) => JSON.parse(
    node.getAttribute("data-glyph-calm-water-changed-glyphs") ?? "[]",
  ) as Array<{ glyphId: string; textIndex: number; lineIndex: number; changedPointCount: number }>);
}

function expectLineByteExact(
  baseline: Awaited<ReturnType<typeof authoritativeGlyphs>>,
  current: Awaited<ReturnType<typeof authoritativeGlyphs>>,
  lineIndex: number,
) {
  const currentById = new Map(current.map((glyph) => [glyph.glyphId, glyph]));
  for (const glyph of baseline.filter((candidate) => candidate.lineIndex === lineIndex)) {
    expect(currentById.get(glyph.glyphId)?.d, glyph.glyphId).toBe(glyph.d);
  }
}

async function pathSignature(page: Page) {
  return page.locator("#substrate-mask path[data-glyph-index]").evaluateAll((paths) => (
    paths.map((path) => path.getAttribute("d") ?? "").join("|")
  ));
}

async function waterSnapshot(page: Page) {
  return stage(page).evaluate((node) => ({
    active: node.getAttribute("data-glyph-calm-water-active") === "true",
    waterKey: node.getAttribute("data-glyph-calm-water-key") ?? "",
    waterGeometryKey: node.getAttribute("data-glyph-calm-water-geometry-key") ?? "",
    domainKey: node.getAttribute("data-glyph-domain-key") ?? "",
    sourceKey: node.getAttribute("data-glyph-source-key") ?? "",
    displacementKey: node.getAttribute("data-glyph-displacement-key") ?? "",
    rendererKey: node.getAttribute("data-renderer-key") ?? "",
    affectedPoints: Number(node.getAttribute("data-glyph-calm-water-affected")),
    maxDisplacement: Number(node.getAttribute("data-glyph-calm-water-max-displacement")),
    safety: node.getAttribute("data-glyph-calm-water-safety") ?? "",
    affectedFragments: Number(node.getAttribute("data-glyph-affected-fragment-count")),
    fragmentCount: Number(node.getAttribute("data-glyph-fragment-count")),
    maxSliceDisplacement: Number(node.getAttribute("data-glyph-max-displacement")),
    footprintViolations: Number(node.getAttribute("data-emitter-micro-final-footprint-violations")),
    relocated: Number(node.getAttribute("data-emitter-micro-relocated")),
    sealedCounterPixels: Number(node.getAttribute("data-emitter-micro-sealed-counter-pixels")),
  }));
}

async function setEmitterRange(page: Page, label: string, value: number) {
  await page.locator(".emitter-row label.range").filter({ hasText: label }).locator('input[type="range"]').fill(String(value));
  await waitForReady(page);
}

async function attachStage(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await stage(page).screenshot(), contentType: "image/png" });
}

const influenceScopeEvidenceDirectory = resolve("e2e-artifacts/glyph-influence-scope");

async function attachInfluenceScopeStage(page: Page, testInfo: TestInfo, name: string) {
  mkdirSync(influenceScopeEvidenceDirectory, { recursive: true });
  const path = resolve(influenceScopeEvidenceDirectory, `${name}.png`);
  await stage(page).screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("Calm Water keeps broad linked rhythm, SVG/Canvas/export parity, and an exact disable round trip", async ({ page }, testInfo) => {
  await loadPreset(page, "Calm Current");
  const enabled = page.getByTestId("glyph-calm-water-enabled");
  await enabled.uncheck();
  await waitForReady(page);
  const baseline = await waterSnapshot(page);
  const baselinePaths = await pathSignature(page);
  expect(baseline.domainKey).toBe(baseline.sourceKey);

  await enabled.check();
  await waitForReady(page);
  const defaultWater = await waterSnapshot(page);
  expect(defaultWater.active).toBe(true);
  expect(defaultWater.affectedPoints).toBeGreaterThan(0);
  expect(defaultWater.maxDisplacement).toBeGreaterThan(0);
  expect(["complete", "displacement-clamped", "topology-guarded"]).toContain(defaultWater.safety);
  expect(await pathSignature(page)).not.toBe(baselinePaths);

  await openDisclosure(page, "Emitters");
  await setEmitterRange(page, "Wave frequency", 0.035);
  const lowFrequency = await waterSnapshot(page);
  const lowPaths = await pathSignature(page);
  await setEmitterRange(page, "Wave frequency", 0.15);
  const highFrequency = await waterSnapshot(page);
  expect(highFrequency.waterKey).not.toBe(lowFrequency.waterKey);
  expect(await pathSignature(page)).not.toBe(lowPaths);

  await page.getByTestId("glyph-calm-water-frequency-linked").uncheck();
  await waitForReady(page);
  const independent = await waterSnapshot(page);
  await setEmitterRange(page, "Wave frequency", 0.22);
  const emitterOnlyChange = await waterSnapshot(page);
  expect(emitterOnlyChange.waterKey).toBe(independent.waterKey);
  expect(emitterOnlyChange.rendererKey).not.toBe(independent.rendererKey);
  await page.getByTestId("glyph-calm-water-wavelength").fill("240");
  await waitForReady(page);
  expect((await waterSnapshot(page)).waterKey).not.toBe(independent.waterKey);
  await attachStage(page, testInfo, "calm-water-high-frequency");

  const svgAuthority = await waterSnapshot(page);
  await page.getByLabel("Preview Mode").selectOption("canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  const canvasAuthority = await waterSnapshot(page);
  expect(canvasAuthority.domainKey).toBe(svgAuthority.domainKey);
  expect(canvasAuthority.waterKey).toBe(svgAuthority.waterKey);
  expect(canvasAuthority.rendererKey).toBe(svgAuthority.rendererKey);
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await waitForReady(page);

  await openPanel(page, "Export");
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export SVG/ }).click();
  const download = await exportPromise;
  const exportPath = await download.path();
  if (!exportPath) throw new Error("SVG export download path was unavailable.");
  const svg = readFileSync(exportPath, "utf8");
  const metadataText = await page.evaluate((source) => new DOMParser()
    .parseFromString(source, "image/svg+xml").querySelector("metadata")?.textContent ?? "", svg);
  const metadata = JSON.parse(metadataText) as {
    project: { version: number };
    glyphCalmWater: { geometryKey: string };
    glyphDomainAuthority: { typographyKey: string; rendererKey: string };
  };
  expect(metadata.project.version).toBe(15);
  expect(metadata.glyphCalmWater.geometryKey).toBe(svgAuthority.waterGeometryKey);
  expect(metadata.glyphDomainAuthority.typographyKey).toBe(svgAuthority.domainKey);
  expect(metadata.glyphDomainAuthority.rendererKey).toBe(svgAuthority.rendererKey);
  expect(svg).not.toMatch(/<image\b|<canvas\b|<foreignObject\b|data:image|;base64,/i);

  await enabled.uncheck();
  await waitForReady(page);
  const restored = await waterSnapshot(page);
  expect(restored.domainKey).toBe(baseline.domainKey);
  expect(restored.sourceKey).toBe(baseline.sourceKey);
  expect(await pathSignature(page)).toBe(baselinePaths);
});

test("Emitter-falloff Slice changes coverage, follows the emitter, preserves Legacy, and keeps particles exterior", async ({ page }, testInfo) => {
  await loadPreset(page, "Tidal Slice");
  await expect(page.getByTestId("glyph-slice-influence")).toHaveValue("emitter-falloff");
  await page.getByTestId("glyph-influence-scope").selectOption("all-typography");
  await page.getByTestId("glyph-influence-softness").fill("80");
  await page.getByTestId("glyph-influence-radius").fill("35");
  await waitForReady(page);
  const small = await waterSnapshot(page);
  expect(small.affectedFragments).toBeGreaterThan(0);
  expect(small.affectedFragments).toBeLessThan(small.fragmentCount);
  await attachStage(page, testInfo, "localized-slice-small-radius");

  await page.getByTestId("glyph-influence-radius").fill("190");
  await waitForReady(page);
  const large = await waterSnapshot(page);
  expect(large.affectedFragments).toBeGreaterThan(small.affectedFragments);
  expect(large.maxSliceDisplacement).toBeGreaterThan(0);
  await attachStage(page, testInfo, "localized-slice-large-radius");

  await openDisclosure(page, "Emitters");
  await page.getByLabel("Source mode").selectOption("custom");
  await setEmitterRange(page, "Emitter X", 390);
  const left = await waterSnapshot(page);
  const leftPaths = await pathSignature(page);
  await setEmitterRange(page, "Emitter X", 810);
  const right = await waterSnapshot(page);
  expect(right.displacementKey).not.toBe(left.displacementKey);
  expect(await pathSignature(page)).not.toBe(leftPaths);

  await page.getByTestId("glyph-slice-influence").selectOption("legacy");
  await waitForReady(page);
  const legacy = await waterSnapshot(page);
  expect(legacy.displacementKey).not.toBe(right.displacementKey);
  await expect(page.getByTestId("glyph-displacement-controls")).toContainText("Global / Legacy");
  await page.getByTestId("glyph-slice-influence").selectOption("emitter-falloff");
  await waitForReady(page);

  await openDisclosure(page, "Emitter Micro Response");
  await page.getByTestId("emitter-micro-occupancy").selectOption("disperse-exterior");
  await waitForReady(page);
  const exterior = await waterSnapshot(page);
  expect(exterior.footprintViolations).toBe(0);
  expect(exterior.relocated).toBeGreaterThan(0);
  expect(exterior.sealedCounterPixels).toBeGreaterThan(0);
  await attachStage(page, testInfo, "water-slice-particles-exterior");
});

test("Private / Sonics large-radius scope matrix keeps semantic ownership separate from coverage", async ({ page }, testInfo) => {
  await loadPrivateSonics(page);
  const baseline = await authoritativeGlyphs(page);
  const sourceO = baseline.find((glyph) => glyph.textIndex === 9);
  expect(sourceO).toMatchObject({ lineIndex: 1, glyphIndexInLine: 1 });

  await page.getByTestId("glyph-influence-radius").fill("640");
  await page.getByTestId("glyph-influence-softness").fill("720");
  await page.getByTestId("glyph-calm-water-enabled").check();

  await page.getByTestId("glyph-influence-scope").selectOption("source-glyph");
  await waitForReady(page);
  const sourceGlyphPaths = await authoritativeGlyphs(page);
  const sourceGlyphChanges = await changedGlyphs(page);
  expect(sourceGlyphChanges).toHaveLength(1);
  expect(sourceGlyphChanges[0]).toMatchObject({
    glyphId: sourceO!.glyphId,
    textIndex: 9,
    lineIndex: 1,
  });
  expect(sourceGlyphChanges[0].changedPointCount).toBeGreaterThan(0);
  const sourceGlyphById = new Map(sourceGlyphPaths.map((glyph) => [glyph.glyphId, glyph]));
  for (const glyph of baseline) {
    if (glyph.glyphId === sourceO!.glyphId) {
      expect(sourceGlyphById.get(glyph.glyphId)?.d).not.toBe(glyph.d);
    } else {
      expect(sourceGlyphById.get(glyph.glyphId)?.d, glyph.glyphId).toBe(glyph.d);
    }
  }
  await attachInfluenceScopeStage(page, testInfo, "scope-01-source-glyph-large-radius");

  const sourceGlyphAuthority = await waterSnapshot(page);
  await page.getByLabel("Preview Mode").selectOption("canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  expect((await waterSnapshot(page)).waterGeometryKey).toBe(sourceGlyphAuthority.waterGeometryKey);
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await waitForReady(page);

  await page.getByTestId("glyph-influence-scope").selectOption("glyph-neighborhood");
  await page.getByTestId("glyph-influence-neighborhood").fill("1");
  await waitForReady(page);
  const neighborPaths = await authoritativeGlyphs(page);
  const neighborChanges = await changedGlyphs(page);
  expect(neighborChanges.some((glyph) => glyph.glyphId === sourceO!.glyphId && glyph.changedPointCount > 0)).toBe(true);
  expect(neighborChanges.every((glyph) => glyph.lineIndex === 1 && Math.abs(glyph.textIndex - 9) <= 1)).toBe(true);
  expectLineByteExact(baseline, neighborPaths, 0);
  await attachInfluenceScopeStage(page, testInfo, "scope-02-glyph-plus-one-neighbor-large-radius");

  await page.getByTestId("glyph-influence-scope").selectOption("source-line");
  await waitForReady(page);
  const linePaths = await authoritativeGlyphs(page);
  const lineChanges = await changedGlyphs(page);
  expect(lineChanges.length).toBeGreaterThan(0);
  expect(lineChanges.every((glyph) => glyph.lineIndex === 1 && glyph.changedPointCount > 0)).toBe(true);
  expectLineByteExact(baseline, linePaths, 0);
  await attachInfluenceScopeStage(page, testInfo, "scope-03-source-line-large-radius");

  await page.getByTestId("glyph-influence-scope").selectOption("all-typography");
  await waitForReady(page);
  const globalChanges = await changedGlyphs(page);
  expect(globalChanges.some((glyph) => glyph.lineIndex === 0 && glyph.changedPointCount > 0)).toBe(true);
  await attachInfluenceScopeStage(page, testInfo, "scope-04-all-typography-large-radius");
});
