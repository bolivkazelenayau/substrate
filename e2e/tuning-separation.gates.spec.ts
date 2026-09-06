import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const stage = (page: Page) => page.getByTestId("viewport-stage");
const evidenceDirectory = resolve("e2e-artifacts/tuning-separation");
const parsedFontFixture = resolve("tests/fixtures/Basic-Regular.ttf");

async function openPanel(page: Page, name: string) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openDisclosure(page: Page, name: string) {
  const button = page.locator("button.accordion-summary").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openSurface(page: Page, testId: string) {
  const button = page.getByTestId(testId).locator("button.surface-disclosure-summary");
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

async function loadDocument(page: Page, document: Record<string, any>, name: string, wait = true) {
  const path = resolve(evidenceDirectory, `${name}.substrate.json`);
  writeFileSync(path, JSON.stringify(document, null, 2));
  await openPanel(page, "Export");
  await page.locator('input[type="file"][accept*="application/json"]').setInputFiles(path);
  if (wait) await waitForReady(page);
}

async function captureEvidence(page: Page, name: string, width: number, height: number) {
  const metrics = await page.locator(".controls").evaluate((node) => {
    const count = (selector: string) => node.querySelectorAll(selector).length;
    return {
      railScrollHeight: node.scrollHeight,
      railClientHeight: node.clientHeight,
      visiblePrimaryControls: count('[data-product-surface="PRIMARY"]'),
      visibleAdvancedControls: count('[data-product-surface="ADVANCED"]'),
      visibleTuningControls: count('label.range[data-product-surface="TUNING"]'),
      hiddenHighConfidenceTuningControls: 26 - count('label.range[data-product-surface="TUNING"]'),
      retainedIndicators: count(".surface-status, .retained-state-summary"),
      safetyStatuses: count('[data-product-surface="SAFETY"] .control-warning, [data-product-surface="PERFORMANCE"] .control-warning'),
    };
  });
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(resolve(evidenceDirectory, `${name}-${width}x${height}.metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`);
  await page.screenshot({ path: resolve(evidenceDirectory, `${name}-${width}x${height}.png`), fullPage: false });
}

async function loadFixtureWithFont(page: Page, document: Record<string, any>, name: string) {
  await loadDocument(page, document, name, false);
  await expect(page.getByLabel("Text substrate")).toHaveValue(String(document.text ?? "SUBSTRATE"));
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  await expect(page.getByTestId("project-message")).toContainText("loaded", { timeout: 60_000 });
  await waitForReady(page);
}

async function renderedOutput(page: Page) {
  return page.locator("#generated-artwork").evaluate((node) => node.innerHTML);
}

type HiddenFixture = {
  name: string;
  document: Record<string, any>;
  owner?: string;
  disclosure: string;
  fields: Array<{ label: string; value: number }>;
};

async function verifyHiddenFixture(page: Page, fixture: HiddenFixture) {
  await loadFixtureWithFont(page, fixture.document, fixture.name);
  const before = await renderedOutput(page);
  if (fixture.owner) await openDisclosure(page, fixture.owner);
  const surface = page.getByTestId(fixture.disclosure);
  for (const field of fixture.fields) {
    await expect(surface.getByLabel(field.label, { exact: true })).toHaveCount(0);
  }
  await openSurface(page, fixture.disclosure);
  for (const field of fixture.fields) {
    await expect(surface.getByRole("button", { name: `${field.label} value, ${field.value}. Activate to edit`, exact: true })).toHaveCount(1);
  }
  const saved = await saveDocument(page);
  await loadFixtureWithFont(page, saved, `${fixture.name}-roundtrip`);
  expect(await renderedOutput(page)).toBe(before);
  if (fixture.owner) await openDisclosure(page, fixture.owner);
  await openSurface(page, fixture.disclosure);
  const roundTripSurface = page.getByTestId(fixture.disclosure);
  for (const field of fixture.fields) {
    await expect(roundTripSurface.getByRole("button", { name: `${field.label} value, ${field.value}. Activate to edit`, exact: true })).toHaveCount(1);
  }
}

test.describe("Tuning Separation Phase 1", () => {
  test("keeps high-confidence tuning discoverable, exact, and separate at both desktop sizes", async ({ page }) => {
    mkdirSync(evidenceDirectory, { recursive: true });
    for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      await page.goto("/");
      await waitForReady(page);
      await captureEvidence(page, "default", size.width, size.height);

      const base = await saveDocument(page);
      const calm = {
        ...base,
        preset: "Custom",
        glyphCalmWater: { ...base.glyphCalmWater, enabled: true, detail: 43 },
      };
      await loadDocument(page, calm, "calm-water");
      await openDisclosure(page, "Calm Water");
      await expect(page.getByLabel("Detail", { exact: true })).toHaveCount(0);
      await openSurface(page, "glyph-calm-water-tuning");
      await expect(page.getByLabel("Detail", { exact: true })).toHaveValue("43");
      await captureEvidence(page, "calm-water", size.width, size.height);

      const fragmentation = {
        ...base,
        preset: "Custom",
        glyphDisplacement: { ...base.glyphDisplacement, enabled: true, mode: "grid", quantizationSteps: 9, seedInfluence: 77 },
      };
      await loadDocument(page, fragmentation, "fragmentation");
      await openDisclosure(page, "Glyph Fragmentation");
      await expect(page.getByLabel("Offset steps", { exact: true })).toHaveCount(0);
      await openSurface(page, "glyph-displacement-tuning");
      await expect(page.getByLabel("Offset steps", { exact: true })).toHaveValue("9");
      await captureEvidence(page, "fragmentation", size.width, size.height);

      const customGlyphModulation = {
        ...base,
        preset: "Custom",
        renderer: "sdf-halftone",
        glyphFieldMode: "strong",
        glyphFieldInfluence: 71,
        glyphFieldDisplacement: 17,
        glyphFieldDensity: 39,
        glyphFieldRadius: 61,
        glyphFieldOpacity: 27,
      };
      await loadDocument(page, customGlyphModulation, "custom-glyph-modulation");
      await openDisclosure(page, "Renderer detail");
      await expect(page.getByLabel("Influence", { exact: true })).toHaveCount(0);
      await openSurface(page, "glyph-modulation-tuning");
      await expect(page.getByLabel("Influence", { exact: true })).toHaveValue("71");
      await expect(page.getByTestId("glyph-modulation-tuning")).toContainText("CUSTOM");
      await captureEvidence(page, "custom-glyph-modulation", size.width, size.height);

      const customMarkResponse = {
        ...base,
        preset: "Custom",
        renderer: "sdf-halftone",
        emitter: { ...base.emitter, enabled: true },
        emitterMicroResponse: { ...base.emitterMicroResponse, enabled: true, positionDetail: 68, densityBreakup: 31, detailScale: 22 },
      };
      await loadDocument(page, customMarkResponse, "custom-mark-response");
      await openDisclosure(page, "Emitter Micro Response");
      await expect(page.getByLabel("Position detail", { exact: true })).toHaveCount(0);
      await openSurface(page, "emitter-micro-tuning");
      await expect(page.getByLabel("Position detail", { exact: true })).toHaveValue("68");
      await captureEvidence(page, "custom-mark-response", size.width, size.height);

      const legacy = {
        ...base,
        preset: "Custom",
        renderer: "sdf-halftone",
        emitter: { ...base.emitter, enabled: true },
        emitterDisplay: { ...base.emitterDisplay, mode: "exclude", interiorSuppression: 73 },
      };
      await loadDocument(page, legacy, "legacy-suppression");
      await openDisclosure(page, "Emitter Display Response");
      await expect(page.getByTestId("emitter-display-response")).toContainText("LEGACY ACTIVE");
      await openSurface(page, "emitter-display-tuning");
      await expect(page.getByRole("slider", { name: "Interior suppression" })).toHaveValue("73");
      await captureEvidence(page, "legacy-suppression", size.width, size.height);

      const safetyCap = {
        ...base,
        preset: "Custom",
        renderer: "sdf-halftone",
        density: 80,
        maxNodes: 400,
        emitter: { ...base.emitter, enabled: true, radius: 520 },
        dotGrid: { ...base.dotGrid, enabled: true },
      };
      await loadDocument(page, safetyCap, "safety-cap-active");
      await openDisclosure(page, "Renderer detail");
      await openSurface(page, "renderer-performance-safety");
      await expect(page.getByRole("slider", { name: "Max nodes / marks" })).toHaveValue("400");
      await captureEvidence(page, "safety-cap-active", size.width, size.height);

      const roundTrip = await saveDocument(page);
      expect(roundTrip.maxNodes).toBe(400);
      expect(roundTrip.glyphCalmWater.detail).toBe(base.glyphCalmWater.detail);
      expect(roundTrip.glyphFieldDensity).toBe(base.glyphFieldDensity);
    }
  });

  test("keeps Preview Performance product-facing and subordinate", async ({ page }) => {
    await page.goto("/");
    await waitForReady(page);
    await openPanel(page, "Preview");
    await expect(page.getByTestId("preview-performance")).toHaveAttribute("data-product-surface", "PERFORMANCE");
    await expect(page.getByLabel("Preview Mode")).toBeVisible();
    await expect(page.getByText(/does not affect SVG export/)).toBeVisible();
    await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  });

  test("round-trips every Phase 1 hidden-value family without normalization", async ({ page }) => {
    await page.goto("/");
    await waitForReady(page);
    await openPanel(page, "Preview");
    await page.getByLabel("Preview Mode").selectOption("svg-dom");
    await waitForReady(page);
    const base = await saveDocument(page);
    const emitterEnabled = { ...base.emitter, enabled: true };
    const fixtures: HiddenFixture[] = [
      {
        name: "micro-warp-hidden",
        owner: "Glyph Micro Warp",
        disclosure: "glyph-micro-warp-tuning",
        document: { ...base, renderer: "sdf-halftone", emitter: emitterEnabled, glyphMicroWarp: { ...base.glyphMicroWarp, enabled: true, detailOctaves: 2, quantizationSteps: 13, seedInfluence: 63 } },
        fields: [{ label: "Detail octaves", value: 2 }, { label: "Detail steps", value: 13 }, { label: "Seed influence", value: 63 }],
      },
      {
        name: "calm-water-hidden",
        owner: "Calm Water",
        disclosure: "glyph-calm-water-tuning",
        document: { ...base, renderer: "sdf-halftone", emitter: emitterEnabled, glyphCalmWater: { ...base.glyphCalmWater, enabled: true, detail: 43 } },
        fields: [{ label: "Detail", value: 43 }],
      },
      {
        name: "fragment-hidden",
        owner: "Glyph Fragmentation",
        disclosure: "glyph-displacement-tuning",
        document: { ...base, renderer: "sdf-halftone", glyphDisplacement: { ...base.glyphDisplacement, enabled: true, mode: "grid", quantizationSteps: 9, seedInfluence: 77 } },
        fields: [{ label: "Offset steps", value: 9 }, { label: "Seed influence", value: 77 }],
      },
      {
        name: "glyph-modulation-hidden",
        owner: "Renderer detail",
        disclosure: "glyph-modulation-tuning",
        document: { ...base, renderer: "sdf-halftone", glyphFieldMode: "strong", glyphFieldInfluence: 71, glyphFieldDisplacement: 17, glyphFieldDensity: 39, glyphFieldRadius: 61, glyphFieldOpacity: 27 },
        fields: [{ label: "Influence", value: 71 }, { label: "Displacement", value: 17 }, { label: "Density modulation", value: 39 }, { label: "Radius modulation", value: 61 }, { label: "Opacity modulation", value: 27 }],
      },
      {
        name: "diffuser-hidden",
        owner: "Renderer detail",
        disclosure: "glyph-diffuser-tuning",
        document: { ...base, renderer: "glyph-diffuser", ringSharpness: 4.4 },
        fields: [{ label: "Ring sharpness", value: 4.4 }],
      },
      {
        name: "display-dislocation-hidden",
        owner: "Renderer-local controls",
        disclosure: "display-dislocation-tuning",
        document: { ...base, renderer: "sdf-halftone", displayDislocation: { ...base.displayDislocation, enabled: true, quantizationSteps: 11, seed: 57 } },
        fields: [{ label: "Display offset steps", value: 11 }, { label: "Seed", value: 57 }],
      },
      {
        name: "emitter-display-hidden",
        owner: "Emitter Display Response",
        disclosure: "emitter-display-tuning",
        document: { ...base, renderer: "sdf-halftone", emitter: emitterEnabled, emitterDisplay: { ...base.emitterDisplay, mode: "distort", noiseScale: 48, gridSize: 17, gridAmount: 64, edgeBias: 31 } },
        fields: [{ label: "Noise scale", value: 48 }, { label: "Grid size", value: 17 }, { label: "Grid amount", value: 64 }, { label: "Edge bias", value: 31 }],
      },
      {
        name: "emitter-micro-hidden",
        owner: "Emitter Micro Response",
        disclosure: "emitter-micro-tuning",
        document: { ...base, renderer: "sdf-halftone", emitter: emitterEnabled, emitterMicroResponse: { ...base.emitterMicroResponse, enabled: true, positionDetail: 68, densityBreakup: 31, detailScale: 22 } },
        fields: [{ label: "Position detail", value: 68 }, { label: "Density breakup", value: 31 }, { label: "Detail scale", value: 22 }],
      },
      {
        name: "glyph-falloff-hidden",
        owner: "Glyph Falloff Field",
        disclosure: "glyph-falloff-tuning",
        document: { ...base, renderer: "sdf-halftone", glyphFalloffDisplacement: { ...base.glyphFalloffDisplacement, mode: "contour-rings", ringSharpness: 4.2 } },
        fields: [{ label: "Ring sharpness", value: 4.2 }],
      },
      {
        name: "appearance-erosion-hidden",
        disclosure: "edge-erosion-tuning",
        document: { ...base, renderer: "glyph-diffuser", overlayMode: "solid", diffuserComposition: "edge-eroded", edgeErosionWidth: 27, interiorProtection: 0.7 },
        fields: [{ label: "Erosion width", value: 27 }, { label: "Interior protection", value: 0.7 }],
      },
      {
        name: "appearance-warp-hidden",
        disclosure: "outline-warp-tuning",
        document: { ...base, renderer: "glyph-diffuser", overlayMode: "warped-outline", outlineWarpSmoothing: 0.35, outlineWarpEdgeBias: 0.65 },
        fields: [{ label: "Warp smoothing", value: 0.35 }, { label: "Warp edge bias", value: 0.65 }],
      },
    ];
    for (const fixture of fixtures) await verifyHiddenFixture(page, fixture);
  });
});
