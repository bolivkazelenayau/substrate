import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { glyphDisplacementScenarios, type GlyphDisplacementScenario } from "./fixtures/glyphDisplacementScenarios";
import { beginScenario, eventsFor, readTrace } from "./helpers/trace";

const fixtureFont = resolve("tests/fixtures/Basic-Regular.ttf");
const screenshotDirectory = resolve("e2e-artifacts/glyph-displacement");
mkdirSync(screenshotDirectory, { recursive: true });

type FragmentSample = {
  id: string;
  dx: number;
  dy: number;
  responseWeight: number;
  sourceBounds: { x: number; y: number; width: number; height: number };
  bounds: { x: number; y: number; width: number; height: number };
};

type Rect = { x: number; y: number; width: number; height: number };
type OutputBounds = Rect & { complete: boolean };

const stage = (page: Page) => page.getByTestId("viewport-stage");
const size = (page: Page) => page.getByTestId("size-control");
const displacementControls = (page: Page) => page.getByTestId("glyph-displacement-controls");

async function waitForReady(page: Page) {
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", "ready", { timeout: 60_000 });
}

async function openPreviewPanel(page: Page) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: "Preview" });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openDisclosure(page: Page, name: string) {
  const button = page.locator("button.accordion-summary").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openSurfaceDisclosure(page: Page, testId: string) {
  const button = page.getByTestId(testId).locator("button.surface-disclosure-summary");
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function setPreviewBackend(page: Page, backend: "svg-dom" | "canvas-2d") {
  await openPreviewPanel(page);
  await page.getByLabel("Preview Mode").selectOption(backend);
  await expect(stage(page)).toHaveAttribute("data-preview-backend", backend, { timeout: 30_000 });
}

async function setSize(page: Page, value: number) {
  await size(page).fill(String(value));
  await size(page).press("Enter");
  await expect(size(page)).toHaveValue(String(value));
  await expect(stage(page)).toHaveAttribute("data-size-interaction-phase", "idle", { timeout: 60_000 });
}

function rangeControl(page: Page, label: string): Locator {
  const owner = label === "Grid spacing" ? page.getByTestId("renderer-local-controls") : displacementControls(page);
  return owner.locator("label.range").filter({ hasText: label }).locator('input[type="range"]').first();
}

async function fillRange(page: Page, label: string, value: number) {
  const control = rangeControl(page, label);
  await expect(control).toBeVisible();
  await control.fill(String(value));
}

async function applyScenario(page: Page, scenario: GlyphDisplacementScenario, overrideSize?: number) {
  await openDisclosure(page, "Renderer-local controls");
  await displacementControls(page).getByTestId("glyph-displacement-mode").selectOption(scenario.mode);
  if (scenario.mode === "horizontal-slices" || scenario.mode === "vertical-slices") {
    await displacementControls(page).getByTestId("glyph-slice-influence").selectOption("legacy");
  }
  await fillRange(page, "Strength", scenario.strength);
  await fillRange(page, "Response radius", scenario.responseRadius);
  await fillRange(page, "Slice / cell size", scenario.fragmentSize);
  if (scenario.mode !== "warp") await fillRange(page, "Gap", scenario.gap);
  await fillRange(page, "Offset steps", scenario.quantizationSteps);
  await fillRange(page, "Direction", scenario.direction);
  await fillRange(page, "Radial / tangential", scenario.radialTangential);
  await fillRange(page, "Jitter", scenario.jitter);
  if (scenario.mode !== "warp") await fillRange(page, "Fragment rotation", scenario.fragmentRotation);
  await page.getByTestId("renderer-local-controls").getByTestId("dot-grid-enabled").setChecked(scenario.dotGrid);
  if (scenario.dotGrid) await fillRange(page, "Grid spacing", scenario.gridSpacing);
  await setSize(page, overrideSize ?? scenario.fontSize);
  await waitForReady(page);
  await expect(stage(page)).toHaveAttribute("data-glyph-displacement-mode", scenario.mode);
  await expect(stage(page)).not.toHaveAttribute("data-glyph-displacement-key", "disabled");
}

async function loadFragmentMatrix(page: Page, scenario: GlyphDisplacementScenario, overrideSize?: number) {
  await page.goto("/");
  await expect(size(page)).toBeVisible();
  await page.locator(".preset-renderer-section select").selectOption("Fragment Matrix");
  await openDisclosure(page, "Glyph Fragmentation");
  await openSurfaceDisclosure(page, "glyph-displacement-tuning");
  await openDisclosure(page, "Renderer-local controls");
  const pause = page.getByRole("button", { name: "Pause animation" });
  if (await pause.count()) await pause.click();
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(fixtureFont);
  await setPreviewBackend(page, "svg-dom");
  await applyScenario(page, scenario, overrideSize);
}

async function metrics(page: Page) {
  const target = stage(page);
  const attribute = (name: string) => target.getAttribute(name);
  const [
    effectiveX, effectiveY, effectiveWidth, effectiveHeight,
    sceneKey, textGeometryKey, sourceKey, displacementKey, domainKey, rendererKey,
    fragmentCount, distinctTransformCount, minResponse, maxResponse, fragmentSample,
    inkBounds, outputBounds, elementCount, dotGridRegular, dotGridSpacing, dotGridOrigin,
    emitterDisplayKey, emitterDisplayMode, emitterDisplaySamples, emitterDisplayAverageDisplacement,
  ] = await Promise.all([
    attribute("data-artboard-effective-x"), attribute("data-artboard-effective-y"),
    attribute("data-artboard-effective-width"), attribute("data-artboard-effective-height"),
    attribute("data-scene-layout-key"), attribute("data-text-geometry-key"),
    attribute("data-glyph-source-key"), attribute("data-glyph-displacement-key"),
    attribute("data-glyph-domain-key"), attribute("data-renderer-key"),
    attribute("data-glyph-fragment-count"), attribute("data-glyph-distinct-transform-count"),
    attribute("data-glyph-min-response"), attribute("data-glyph-max-response"),
    attribute("data-glyph-fragment-sample"), attribute("data-glyph-ink-bounds"),
    attribute("data-renderer-output-bounds"), attribute("data-renderer-element-count"),
    attribute("data-dot-grid-regular"), attribute("data-dot-grid-spacing"),
    attribute("data-dot-grid-origin"), attribute("data-emitter-display-key"),
    attribute("data-emitter-display-mode"), attribute("data-emitter-display-samples"),
    attribute("data-emitter-display-average-displacement"),
  ]);
  return {
    effectiveRect: { x: Number(effectiveX), y: Number(effectiveY), width: Number(effectiveWidth), height: Number(effectiveHeight) },
    sceneKey: sceneKey ?? "",
    textGeometryKey: textGeometryKey ?? "",
    sourceKey: sourceKey ?? "",
    displacementKey: displacementKey ?? "",
    domainKey: domainKey ?? "",
    rendererKey: rendererKey ?? "",
    fragmentCount: Number(fragmentCount),
    distinctTransformCount: Number(distinctTransformCount),
    minResponse: Number(minResponse),
    maxResponse: Number(maxResponse),
    fragmentSample: JSON.parse(fragmentSample ?? "[]") as FragmentSample[],
    inkBounds: JSON.parse(inkBounds ?? "null") as Rect | null,
    outputBounds: JSON.parse(outputBounds ?? "null") as OutputBounds | null,
    elementCount: Number(elementCount),
    dotGridRegular: dotGridRegular === "true",
    dotGridSpacing: Number(dotGridSpacing),
    dotGridOrigin: dotGridOrigin ?? "",
    emitterDisplayKey: emitterDisplayKey ?? "",
    emitterDisplayMode: emitterDisplayMode ?? "",
    emitterDisplaySamples: Number(emitterDisplaySamples),
    emitterDisplayAverageDisplacement: Number(emitterDisplayAverageDisplacement),
  };
}

async function displacedSubpathCount(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<SVGPathElement>("#substrate-mask path")]
    .reduce((sum, path) => sum + (path.getAttribute("d")?.match(/M/gi)?.length ?? 0), 0));
}

async function captureFixture(page: Page, fileName: string) {
  await setPreviewBackend(page, "svg-dom");
  await page.getByTestId("artwork-svg").screenshot({ path: resolve(screenshotDirectory, fileName) });
}

function averageMovement(samples: FragmentSample[]) {
  return samples.length
    ? samples.reduce((sum, sample) => sum + Math.hypot(sample.dx, sample.dy), 0) / samples.length
    : 0;
}

test("Gate 1 — horizontal slices open hard gaps with coherent quantized offsets", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.horizontal);
  const result = await metrics(page);
  expect(result.fragmentCount).toBeGreaterThan(3);
  expect(result.distinctTransformCount).toBeGreaterThan(2);
  const horizontalOffsets = result.fragmentSample.map(({ dx }) => dx);
  expect(horizontalOffsets.some((offset) => Math.abs(offset) > 2)).toBe(true);
  expect(Math.max(...horizontalOffsets) - Math.min(...horizontalOffsets)).toBeGreaterThan(4);
  expect(await displacedSubpathCount(page)).toBeGreaterThan(result.fragmentCount);
  expect(Number(await rangeControl(page, "Gap").inputValue())).toBeGreaterThan(0);
  expect(result.textGeometryKey).toBe(result.domainKey);
  await captureFixture(page, "horizontal-slice-breakup.png");
});

test("Visual fixture — grid fragmentation creates multiple cell transforms", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.grid);
  const result = await metrics(page);
  const offsets = new Set(result.fragmentSample.map(({ dx, dy }) => `${dx.toFixed(2)},${dy.toFixed(2)}`));
  expect(result.fragmentCount).toBeGreaterThan(8);
  expect(offsets.size).toBeGreaterThan(3);
  expect(await displacedSubpathCount(page)).toBeGreaterThan(result.fragmentCount);
  await captureFixture(page, "grid-fragmentation.png");
});

test("Gate 2 — radial emitter breakup moves near fragments more than distant fragments", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.radial);
  const result = await metrics(page);
  const ordered = [...result.fragmentSample].sort((a, b) => a.responseWeight - b.responseWeight);
  const groupSize = Math.max(1, Math.floor(ordered.length / 4));
  const distant = ordered.slice(0, groupSize);
  const near = ordered.slice(-groupSize);
  expect(result.maxResponse).toBeGreaterThan(result.minResponse);
  expect(averageMovement(near)).toBeGreaterThan(averageMovement(distant));
  await captureFixture(page, "radial-emitter-breakup.png");
});

test("Gate 3 — regular dot grid samples the displaced domain on a stable world lattice", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.dotMatrix);
  const result = await metrics(page);
  expect(result.dotGridRegular).toBe(true);
  expect(result.dotGridOrigin).toBe("0,0");
  expect(result.dotGridSpacing).toBe(glyphDisplacementScenarios.dotMatrix.gridSpacing);
  expect(result.outputBounds).toMatchObject({ complete: true });
  expect(result.elementCount).toBeGreaterThan(100);
  const membership = await page.evaluate(({ spacing }) => {
    const circles = [...document.querySelectorAll<SVGCircleElement>("#generated-artwork > circle")];
    const paths = [...document.querySelectorAll<SVGPathElement>("#substrate-mask path")]
      .map((path) => path.getAttribute("d"))
      .filter((value): value is string => Boolean(value));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const vectorPaths = paths.map((path) => new Path2D(path));
    const sampled = circles.slice(0, 160);
    return {
      count: circles.length,
      regular: sampled.every((circle) => {
        const x = Number(circle.getAttribute("cx"));
        const y = Number(circle.getAttribute("cy"));
        return Math.abs(x / spacing - Math.round(x / spacing)) < 1e-6
          && Math.abs(y / spacing - Math.round(y / spacing)) < 1e-6;
      }),
      insideRatio: context ? sampled.filter((circle) => {
        const x = Number(circle.getAttribute("cx"));
        const y = Number(circle.getAttribute("cy"));
        return vectorPaths.some((path) => context!.isPointInPath(path, x, y, "nonzero"));
      }).length / Math.max(1, sampled.length) : 0,
    };
  }, { spacing: glyphDisplacementScenarios.dotMatrix.gridSpacing });
  expect(membership.count).toBe(result.elementCount);
  expect(membership.regular).toBe(true);
  expect(membership.insideRatio).toBeGreaterThan(0.9);
  await captureFixture(page, "dot-matrix-displacement.png");
});

test("Gate 4 — glyph displacement and mark-space orbit remain separate active stages", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.combined);
  const before = await metrics(page);
  const emitters = page.locator("button.accordion-summary").filter({ hasText: "Emitters" });
  if ((await emitters.getAttribute("aria-expanded")) !== "true") await emitters.click();
  await openDisclosure(page, "Emitter Display Response");
  await page.getByTestId("emitter-display-response").getByLabel("Behavior").selectOption("orbit");
  await waitForReady(page);
  await expect(stage(page)).toHaveAttribute("data-emitter-display-mode", "orbit");
  const combined = await metrics(page);
  expect(combined.domainKey).toBe(before.domainKey);
  expect(combined.displacementKey).toBe(before.displacementKey);
  expect(combined.emitterDisplayKey).not.toBe(before.emitterDisplayKey);
  expect(combined.emitterDisplaySamples).toBeGreaterThan(0);
  expect(combined.emitterDisplayAverageDisplacement).toBeGreaterThan(0);
  const offGrid = await page.evaluate(({ spacing }) => [...document.querySelectorAll<SVGCircleElement>("#generated-artwork > circle")]
    .filter((circle) => {
      const x = Number(circle.getAttribute("cx"));
      const y = Number(circle.getAttribute("cy"));
      return Math.abs(x / spacing - Math.round(x / spacing)) > 1e-4
        || Math.abs(y / spacing - Math.round(y / spacing)) > 1e-4;
    }).length, { spacing: glyphDisplacementScenarios.combined.gridSpacing });
  expect(offGrid).toBeGreaterThan(0);
  await captureFixture(page, "combined-glyph-and-mark-displacement.png");
});

test("Gate 5 — SVG Accuracy and Canvas Performance share all semantic authorities", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.dotMatrix);
  const svg = await metrics(page);
  await setPreviewBackend(page, "canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  const canvas = await metrics(page);
  expect(canvas.domainKey).toBe(svg.domainKey);
  expect(canvas.displacementKey).toBe(svg.displacementKey);
  expect(canvas.sceneKey).toBe(svg.sceneKey);
  expect(canvas.rendererKey).toBe(svg.rendererKey);
  expect(canvas.effectiveRect).toEqual(svg.effectiveRect);
  expect(canvas.elementCount).toBe(svg.elementCount);
  expect(canvas.outputBounds).toEqual(svg.outputBounds);
  await page.getByTestId("artwork-canvas").screenshot({ path: resolve(screenshotDirectory, "canvas-performance-parity.png") });
});

test("Gate 6 — Final Artwork export preserves vector circles, bounds, and authority keys", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.dotMatrix);
  const exportPanel = page.locator("button.panel-heading-button").filter({ hasText: "Export" });
  if ((await exportPanel.getAttribute("aria-expanded")) !== "true") await exportPanel.click();
  await page.getByLabel("Numeric precision").selectOption("3");
  await waitForReady(page);
  const preview = await metrics(page);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("button.export").click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const svg = readFileSync(downloadPath!, "utf8");
  writeFileSync(resolve(screenshotDirectory, "dot-matrix-final-artwork.svg"), svg, "utf8");
  expect(svg).not.toMatch(/<image\b|<canvas\b|<foreignObject\b/i);
  const metadataText = await page.evaluate((source) => new DOMParser()
    .parseFromString(source, "image/svg+xml").querySelector("metadata")?.textContent ?? "", svg);
  const metadata = JSON.parse(metadataText) as {
    effectiveArtboard: Rect;
    glyphDisplacement: { geometryKey: string; displacementKey: string; fragmentCount: number };
    glyphDomainAuthority: {
      typographyKey: string;
      sceneKey: string;
      rendererKey: string;
      rendererElementCount: number;
      rendererOutputBounds: OutputBounds;
    };
  };
  expect(metadata.glyphDisplacement.geometryKey).toBe(preview.domainKey);
  expect(metadata.glyphDisplacement.displacementKey).toBe(preview.displacementKey);
  expect(metadata.glyphDisplacement.fragmentCount).toBe(preview.fragmentCount);
  expect(metadata.glyphDomainAuthority).toMatchObject({
    typographyKey: preview.domainKey,
    sceneKey: preview.sceneKey,
    rendererKey: preview.rendererKey,
    rendererElementCount: preview.elementCount,
    rendererOutputBounds: preview.outputBounds,
  });
  expect(metadata.effectiveArtboard).toEqual(preview.effectiveRect);
  const circles = [...svg.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]), r: Number(match[3]) }));
  expect(circles).toHaveLength(preview.elementCount);
  const exportedBounds = circles.reduce((bounds, circle) => ({
    x: Math.min(bounds.x, circle.x - circle.r),
    y: Math.min(bounds.y, circle.y - circle.r),
    maxX: Math.max(bounds.maxX, circle.x + circle.r),
    maxY: Math.max(bounds.maxY, circle.y + circle.r),
  }), { x: Infinity, y: Infinity, maxX: -Infinity, maxY: -Infinity });
  expect(exportedBounds.x).toBeCloseTo(preview.outputBounds!.x, 1);
  expect(exportedBounds.y).toBeCloseTo(preview.outputBounds!.y, 1);
  expect(exportedBounds.maxX - exportedBounds.x).toBeCloseTo(preview.outputBounds!.width, 1);
  expect(exportedBounds.maxY - exportedBounds.y).toBeCloseTo(preview.outputBounds!.height, 1);
});

test("Gate 7 — 148 → 540 → 148 restores exact keys and active Size drag defers displacement rebuild", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.horizontal, 148);
  const initial = await metrics(page);
  await setSize(page, 540);
  await waitForReady(page);
  const large = await metrics(page);
  expect(large.domainKey).not.toBe(initial.domainKey);
  expect(large.sceneKey).not.toBe(initial.sceneKey);
  await setSize(page, 148);
  await waitForReady(page);
  const restored = await metrics(page);
  expect(restored).toEqual(initial);

  await beginScenario(page, "glyph-displacement-size-drag");
  const box = await size(page).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.58, box!.y + box!.height / 2, { steps: 8 });
  const duringDrag = await readTrace(page);
  expect(eventsFor(duringDrag, "typography.displacement.build", "end")).toHaveLength(0);
  await page.mouse.up();
  await waitForReady(page);
  const afterCommit = await readTrace(page);
  expect(eventsFor(afterCommit, "typography.displacement.build", "end")).toHaveLength(1);
  await setSize(page, 148);
  await waitForReady(page);
});

test("Gate 8 — disabling displacement restores the exact base geometry authority", async ({ page }) => {
  await loadFragmentMatrix(page, glyphDisplacementScenarios.grid);
  const active = await metrics(page);
  const enabled = displacementControls(page).getByTestId("glyph-displacement-enabled");
  await enabled.uncheck();
  await waitForReady(page);
  const firstDisabled = await metrics(page);
  expect(firstDisabled.displacementKey).toBe("disabled");
  expect(firstDisabled.domainKey).toBe(firstDisabled.sourceKey);
  expect(firstDisabled.textGeometryKey).toBe(firstDisabled.sourceKey);
  expect(firstDisabled.domainKey).not.toBe(active.domainKey);

  await enabled.check();
  await waitForReady(page);
  expect((await metrics(page)).domainKey).toBe(active.domainKey);
  await enabled.uncheck();
  await waitForReady(page);
  const secondDisabled = await metrics(page);
  expect(secondDisabled.domainKey).toBe(firstDisabled.domainKey);
  expect(secondDisabled.sceneKey).toBe(firstDisabled.sceneKey);
  expect(secondDisabled.effectiveRect).toEqual(firstDisabled.effectiveRect);
  expect(secondDisabled.outputBounds).toEqual(firstDisabled.outputBounds);
});
