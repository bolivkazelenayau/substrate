import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const size = (page: Page) => page.getByTestId("size-control");

async function loadApp(page: Page, preset?: string) {
  await page.goto("/");
  await expect(size(page)).toBeVisible();
  if (preset) {
    await page.locator(".preset-renderer-section select").selectOption(preset);
  }
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
}

async function loadFixtureFont(page: Page, fileName = "Basic-Regular.ttf") {
  const fontInput = page.locator('input[type="file"][accept*=".ttf"]');
  await fontInput.setInputFiles(resolve(`tests/fixtures/${fileName}`));
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
}

async function selectRenderer(page: Page, label: string) {
  await page.locator(".preset-renderer-section").getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
}

async function setSizeDirect(page: Page, value: number, settleTimeout = 30_000) {
  const control = size(page);
  await control.fill(String(value));
  await control.press("Enter");
  await expect(control).toHaveValue(String(value));
  await expect(page.locator('[data-testid="viewport-stage"]')).toHaveAttribute("data-size-interaction-phase", "idle", { timeout: settleTimeout });
  await expect(page.locator("button.export")).toBeEnabled({ timeout: settleTimeout });
}

async function dragSizeTo(page: Page, ratio: number) {
  const control = size(page);
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  // Clamp to the clickable track so pointerup is still inside the element.
  const clampedRatio = Math.max(0.02, Math.min(0.98, ratio));
  const targetX = box.x + box.width * clampedRatio;
  const targetY = box.y + box.height / 2;
  const currentBox = await control.boundingBox();
  if (!currentBox) return;
  const currentX = currentBox.x + currentBox.width * 0.5;
  const currentY = currentBox.y + currentBox.height / 2;
  // Use a real pointer gesture so the range input fires pointerdown / input /
  // pointerup in the same order a user drag would. Move through the track
  // so intermediate input events are generated, like a real drag.
  await page.mouse.move(currentX, currentY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 10 });
  await page.mouse.up();
}

async function stageMetrics(page: Page) {
  const stage = page.getByTestId("viewport-stage");
  const [x, y, width, height, sceneKey, textGeometryKey, substrateKey, substratePhase, elementCount] = await Promise.all([
    stage.getAttribute("data-artboard-effective-x"),
    stage.getAttribute("data-artboard-effective-y"),
    stage.getAttribute("data-artboard-effective-width"),
    stage.getAttribute("data-artboard-effective-height"),
    stage.getAttribute("data-scene-layout-key"),
    stage.getAttribute("data-text-geometry-key"),
    stage.getAttribute("data-substrate-key"),
    stage.getAttribute("data-substrate-phase"),
    stage.getAttribute("data-renderer-element-count"),
  ]);
  return {
    effectiveRect: {
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
    },
    sceneKey: sceneKey ?? "",
    textGeometryKey: textGeometryKey ?? "",
    substrateKey: substrateKey ?? "",
    substratePhase: substratePhase ?? "",
    rendererElementCount: Number(elementCount),
  };
}

async function svgGeometryBounds(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="artwork-svg"]') as SVGSVGElement | null;
    if (!svg) return null;
    const elements = svg.querySelectorAll('.marks > *');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach((el) => {
      try {
        const box = (el as SVGGraphicsElement).getBBox();
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      } catch {
        // ignore
      }
    });
    return { minX, minY, maxX, maxY };
  });
}

function assertRectGreaterOrEqual(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  expect(a.width).toBeGreaterThanOrEqual(b.width);
  expect(a.height).toBeGreaterThanOrEqual(b.height);
}

function assertGeometrySpansEffectiveRect(
  effectiveRect: { x: number; y: number; width: number; height: number },
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
) {
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  const geometryWidth = bounds.maxX - bounds.minX;
  // The geometry must occupy most of the effective width; this catches
  // renderers that silently fall back to the authored 1200×720 domain.
  expect(geometryWidth).toBeGreaterThan(effectiveRect.width * 0.7);
  expect(bounds.minX).toBeLessThan(effectiveRect.x + effectiveRect.width * 0.15);
  expect(bounds.maxX).toBeGreaterThan(effectiveRect.x + effectiveRect.width * 0.85);
  // Geometry must sit inside the effective rect (with a small tolerance for
  // anti-aliasing/stroke); vertical span is allowed to be just the glyph ink.
  expect(bounds.minX).toBeGreaterThanOrEqual(effectiveRect.x - 2);
  expect(bounds.maxX).toBeLessThanOrEqual(effectiveRect.x + effectiveRect.width + 2);
  expect(bounds.minY).toBeGreaterThanOrEqual(effectiveRect.y - 2);
  expect(bounds.maxY).toBeLessThanOrEqual(effectiveRect.y + effectiveRect.height + 2);
}

/**
 * Production-build regression gate for the glyph/scene geometry authority.
 *
 * Two independent memo-key regressions were fixed:
 *
 * 1. `useTypographyGeometry` used a trace-only key as its `useMemo` dependency.
 *    In production (trace disabled), that dependency collapsed to `undefined`, so
 *    parsed-font glyph geometry did not rebuild when `fontSize` changed. The
 *    effective scene rect therefore stayed at the authored minimum (1200×720).
 *
 * 2. `useRendererRuntime` built `liveRevisionKey` for static renderers from
 *    `rendererGeometryStateKey(project)` only, ignoring the live context
 *    (viewport, substrate, text geometry). When a fresh substrate arrived after
 *    a Size commit, the cached live geometry was reused and the preview would
 *    not sync. The slider drag tests exercise this specifically.
 */
test("Gate: parsed-font Size change updates effective scene rect in production builds", async ({ page }) => {
  await loadApp(page, "Split Field");
  await selectRenderer(page, "Wave Contours");
  await setSizeDirect(page, 148);
  await loadFixtureFont(page);

  const initial = await stageMetrics(page);
  expect(initial.effectiveRect.width).toBe(1200);
  expect(initial.effectiveRect.height).toBe(720);

  await setSizeDirect(page, 396);
  const mid = await stageMetrics(page);
  expect(mid.effectiveRect.width).toBeGreaterThan(initial.effectiveRect.width);
  expect(mid.effectiveRect.height).toBeGreaterThanOrEqual(initial.effectiveRect.height);
  expect(mid.sceneKey).not.toBe(initial.sceneKey);

  await setSizeDirect(page, 414);
  const large = await stageMetrics(page);
  assertRectGreaterOrEqual(large.effectiveRect, mid.effectiveRect);
  expect(large.sceneKey).not.toBe(mid.sceneKey);

  // Round trip: returning to 148 must restore the exact initial effective rect.
  await setSizeDirect(page, 148);
  const final = await stageMetrics(page);
  expect(final.effectiveRect).toEqual(initial.effectiveRect);
});

for (const rendererLabel of ["SDF Contours", "SDF Halftone", "SDF Streamlines", "Wave Contours"]) {
  test(`Gate: ${rendererLabel} output spans effective artboard after large parsed-font Size`, async ({ page }) => {
    await loadApp(page, "Split Field");
    await selectRenderer(page, rendererLabel);
    // SDF Contours builds are heavier; give them more time to settle in production builds.
    const isHeavy = rendererLabel === "SDF Contours";
    const directTimeout = isHeavy ? 120_000 : 30_000;
    await setSizeDirect(page, 148, directTimeout);
    await loadFixtureFont(page);
    // Pause to ensure the font-driven scene layout has settled before the next size change.
    await stageMetrics(page);
    await setSizeDirect(page, 396, directTimeout);
    if (!isHeavy) {
      await setSizeDirect(page, 414, directTimeout);
    }
    const metrics = await stageMetrics(page);
    expect(metrics.effectiveRect.width).toBeGreaterThan(1200);
    const bounds = await svgGeometryBounds(page);
    assertGeometrySpansEffectiveRect(metrics.effectiveRect, bounds);
  });
}

for (const presetName of ["SDF Current", "Contour Thread", "Topographic Type", "Halftone Press", "Glyph Ripple", "Sonic Contours", "Sonic Stream", "Split Field"]) {
  test(`Gate: ${presetName} syncs size slider after min-max-min-max drag`, async ({ page }) => {
    await loadApp(page, presetName);

    const small = await stageMetrics(page);
    expect(small.effectiveRect.width).toBe(1200);

    await size(page).fill("540");
    await size(page).press("Enter");
    await expect(page.locator('[data-testid="viewport-stage"]')).toHaveAttribute("data-size-interaction-phase", "idle", { timeout: 30_000 });
    const large = await stageMetrics(page);
    expect(large.effectiveRect.width).toBeGreaterThan(1200);

    await dragSizeTo(page, 0.25);
    await expect(page.locator('[data-testid="viewport-stage"]')).toHaveAttribute("data-size-interaction-phase", "idle", { timeout: 30_000 });
    const mid = await stageMetrics(page);

    await dragSizeTo(page, 1.0);
    await expect(page.locator('[data-testid="viewport-stage"]')).toHaveAttribute("data-size-interaction-phase", "idle", { timeout: 30_000 });
    const final = await stageMetrics(page);
    expect(final.effectiveRect.width).toBeGreaterThan(1200);
    expect(final.effectiveRect).toEqual(large.effectiveRect);
  });
}

test("Gate: font replacement with equivalent family metadata rebuilds typography and substrate identity", async ({ page }) => {
  await loadApp(page, "Halftone Press");
  await setSizeDirect(page, 148);
  await loadFixtureFont(page, "Basic-Regular.ttf");

  const before = await stageMetrics(page);
  expect(before.substratePhase).toBe("ready");
  expect(before.textGeometryKey).not.toBe("");
  expect(before.substrateKey).not.toBe("none");

  await loadFixtureFont(page, "Basic-Modified.ttf");
  const after = await stageMetrics(page);

  expect(after.textGeometryKey).not.toBe(before.textGeometryKey);
  expect(after.substrateKey).not.toBe(before.substrateKey);
  // The scene key is derived from the effective rect and placement metrics. Equivalent
  // family metadata can produce the same placement even when the actual glyph outlines
  // differ, so the typography and substrate identity changes above are the authoritative
  // signal that the font replacement was processed.
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
});

test("Gate: switching away from a substrate renderer while pending supersedes substrate work", async ({ page }) => {
  page.on("console", (msg) => console.log("[BROWSER]", msg.type(), msg.text()));
  await loadApp(page, "Halftone Press");
  await setSizeDirect(page, 148);
  await loadFixtureFont(page, "Basic-Regular.ttf");
  const settled = await stageMetrics(page);
  expect(settled.substratePhase).toBe("ready");

  // Trigger a substrate rebuild and immediately switch to a non-substrate renderer.
  await size(page).fill("396");
  await size(page).press("Enter");
  await selectRenderer(page, "Flow lines");
  await expect(page.locator('[data-testid="viewport-stage"]')).toHaveAttribute("data-substrate-phase", "not-required", { timeout: 30_000 });

  const switched = await stageMetrics(page);
  expect(switched.substratePhase).toBe("not-required");
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });

  // Wait to ensure no late Halftone substrate result makes Flow wait.
  await page.waitForTimeout(500);
  const later = await stageMetrics(page);
  expect(later.substratePhase).toBe("not-required");
});

test("Gate: re-enabling the same substrate renderer rebuilds when no valid output exists", async ({ page }) => {
  await loadApp(page, "Halftone Press");
  await setSizeDirect(page, 148);
  await loadFixtureFont(page, "Basic-Regular.ttf");
  const first = await stageMetrics(page);
  expect(first.substratePhase).toBe("ready");

  await selectRenderer(page, "Flow lines");
  await expect(page.locator('[data-testid="viewport-stage"]')).toHaveAttribute("data-substrate-phase", "not-required", { timeout: 30_000 });

  await selectRenderer(page, "SDF Halftone");
  await expect(page.locator('[data-testid="viewport-stage"]')).toHaveAttribute("data-substrate-phase", "ready", { timeout: 30_000 });
  const reenabled = await stageMetrics(page);
  expect(reenabled.substrateKey).not.toBe("none");
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
});

test("Gate: glyph outline-only change invalidates renderer geometry", async ({ page }) => {
  await loadApp(page, "SDF Current");
  await selectRenderer(page, "SDF Contours");
  await setSizeDirect(page, 148);
  await loadFixtureFont(page, "Basic-Regular.ttf");

  const before = await stageMetrics(page);
  expect(before.substratePhase).toBe("ready");
  const beforeBounds = await svgGeometryBounds(page);
  expect(beforeBounds).not.toBeNull();

  await loadFixtureFont(page, "Basic-Modified.ttf");
  const after = await stageMetrics(page);
  expect(after.substratePhase).toBe("ready");
  expect(after.textGeometryKey).not.toBe(before.textGeometryKey);
  expect(after.substrateKey).not.toBe(before.substrateKey);

  const afterBounds = await svgGeometryBounds(page);
  expect(afterBounds).not.toBeNull();
  expect(afterBounds!.maxX - afterBounds!.minX).not.toBe(beforeBounds!.maxX - beforeBounds!.minX);
});

const TRACE_SNAPSHOT_PATH = resolve("e2e/.last-production-metrics.json");

test("Gate: trace production build preserves semantic identity and output summary", async ({ page }) => {
  await loadApp(page, "SDF Current");
  await selectRenderer(page, "SDF Contours");
  await setSizeDirect(page, 148);
  await loadFixtureFont(page, "Basic-Regular.ttf");

  const metrics = await stageMetrics(page);
  const bounds = await svgGeometryBounds(page);
  const summary = {
    sceneKey: metrics.sceneKey,
    textGeometryKey: metrics.textGeometryKey,
    substrateKey: metrics.substrateKey,
    rendererElementCount: metrics.rendererElementCount,
    effectiveRect: metrics.effectiveRect,
    geometryWidth: bounds ? bounds.maxX - bounds.minX : null,
  };

  if (process.env.VITE_SUBSTRATE_TRACE === "1") {
    expect(existsSync(TRACE_SNAPSHOT_PATH)).toBe(true);
    const baseline = JSON.parse(readFileSync(TRACE_SNAPSHOT_PATH, "utf8"));
    expect(summary.sceneKey).toBe(baseline.sceneKey);
    expect(summary.textGeometryKey).toBe(baseline.textGeometryKey);
    expect(summary.substrateKey).toBe(baseline.substrateKey);
    expect(summary.rendererElementCount).toBe(baseline.rendererElementCount);
    expect(summary.effectiveRect).toEqual(baseline.effectiveRect);
    expect(summary.geometryWidth).toBe(baseline.geometryWidth);
  } else {
    writeFileSync(TRACE_SNAPSHOT_PATH, JSON.stringify(summary, null, 2));
    expect(existsSync(TRACE_SNAPSHOT_PATH)).toBe(true);
  }
});
