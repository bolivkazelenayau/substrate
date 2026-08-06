import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectFixture = resolve("tests/fixtures/projects/legacy/private-sonics-v8.substrate.json");
const fontFixture = resolve("tests/fixtures/Basic-Regular.ttf");
const evidenceDirectory = resolve("e2e-artifacts/glyph-falloff-displacement");
const stage = (page: Page) => page.getByTestId("viewport-stage");

mkdirSync(evidenceDirectory, { recursive: true });

async function openPanel(page: Page, name: string) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openAccordion(page: Page, name: string) {
  const button = page.locator("button.accordion-summary").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function waitForReady(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", "ready", { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute("data-text-geometry-key", /.+/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled({ timeout: 60_000 });
}

async function setPreviewBackend(page: Page, backend: "svg-dom" | "canvas-2d") {
  await openPanel(page, "Preview");
  await page.getByLabel("Preview Mode").selectOption(backend);
  await expect(stage(page)).toHaveAttribute("data-preview-backend", backend);
}

async function loadScenario(page: Page) {
  await page.goto("/");
  await openPanel(page, "Export");
  await page.locator('input[type="file"][accept*="application/json"]').setInputFiles(projectFixture);
  await expect(page.getByLabel("Text substrate")).toHaveValue("Private\nSonics");
  await expect(page.locator('[aria-label="Renderer"] button.active')).toContainText("Glyph Diffuser");
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(fontFixture);
  await expect(page.getByTestId("project-message")).toContainText("loaded", { timeout: 60_000 });
  await waitForReady(page);
  await setPreviewBackend(page, "svg-dom");
  await openAccordion(page, "Glyph Falloff Field");
}

async function setRange(page: Page, testId: string, value: number) {
  await page.getByTestId(testId).fill(String(value));
}

async function setRingFrequency(page: Page, value: number) {
  await setRange(page, "glyph-falloff-ring-frequency", value);
  await expect(stage(page)).toHaveAttribute("data-glyph-falloff-ring-frequency", String(value));
  await waitForReady(page);
}

async function geometrySignature(page: Page) {
  return page.locator("#generated-artwork > circle").evaluateAll((nodes) => {
    let hash = 2_166_136_261;
    for (const node of nodes) {
      const signature = ["cx", "cy", "r", "opacity"]
        .map((attribute) => node.getAttribute(attribute) ?? "")
        .join(",");
      for (let index = 0; index < signature.length; index += 1) {
        hash ^= signature.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
      }
    }
    return `${nodes.length}:${hash >>> 0}`;
  });
}

async function metrics(page: Page) {
  return stage(page).evaluate((node) => ({
    rendererKey: node.getAttribute("data-renderer-key") ?? "",
    falloffKey: node.getAttribute("data-glyph-falloff-key") ?? "",
    falloffMode: node.getAttribute("data-glyph-falloff-mode") ?? "",
    falloffAffected: Number(node.getAttribute("data-glyph-falloff-affected")),
    falloffSdfReads: Number(node.getAttribute("data-glyph-falloff-sdf-reads")),
    falloffMaxDisplacement: Number(node.getAttribute("data-glyph-falloff-max-displacement")),
    microMode: node.getAttribute("data-emitter-micro-mode") ?? "",
    finalExterior: Number(node.getAttribute("data-emitter-micro-final-exterior")),
    finalFootprintViolations: Number(node.getAttribute("data-emitter-micro-final-footprint-violations")),
    elementCount: Number(node.getAttribute("data-renderer-element-count")),
  }));
}

async function footprintProbe(page: Page) {
  return page.evaluate(() => {
    const glyphPaths = [...document.querySelectorAll<SVGGeometryElement>("#substrate-mask path")];
    const marks = [...document.querySelectorAll<SVGCircleElement>("#generated-artwork > circle")];
    let violations = 0;
    for (const mark of marks) {
      const x = Number(mark.getAttribute("cx"));
      const y = Number(mark.getAttribute("cy"));
      const radius = Number(mark.getAttribute("r"));
      const points = [new DOMPoint(x, y)];
      for (let index = 0; index < 16; index += 1) {
        const angle = index / 16 * Math.PI * 2;
        points.push(new DOMPoint(
          x + Math.cos(angle) * (radius + 0.01),
          y + Math.sin(angle) * (radius + 0.01),
        ));
      }
      if (points.some((point) => glyphPaths.some((path) => path.isPointInFill(point)))) violations += 1;
    }
    return { marks: marks.length, glyphPaths: glyphPaths.length, violations };
  });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = resolve(evidenceDirectory, `${name}.png`);
  const body = await stage(page).screenshot({ path });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

test("Glyph falloff baseline, contour rings, exterior occupancy, and output parity", async ({ page }, testInfo) => {
  await loadScenario(page);

  await expect(stage(page)).toHaveAttribute("data-glyph-falloff-mode", "disabled");
  await expect(stage(page)).toHaveAttribute("data-glyph-falloff-key", "glyph-falloff:disabled");
  const baseline = await metrics(page);
  const baselineSignature = await geometrySignature(page);
  expect(baseline.elementCount).toBeGreaterThan(0);
  await capture(page, testInfo, "01-baseline");

  await page.getByTestId("glyph-falloff-mode").selectOption("contour-rings");
  await setRange(page, "glyph-falloff-strength", 34);
  await setRange(page, "glyph-falloff-width", 120);
  await page.getByTestId("glyph-falloff-curve").selectOption("smoothstep");
  await setRingFrequency(page, 4);
  await setRange(page, "glyph-falloff-ring-sharpness", 3.2);
  await expect(stage(page)).toHaveAttribute("data-glyph-falloff-mode", "contour-rings");
  await expect.poll(async () => (await metrics(page)).falloffAffected).toBeGreaterThan(0);
  const active = await metrics(page);
  expect(active.rendererKey).not.toBe(baseline.rendererKey);
  expect(active.falloffKey).not.toBe("glyph-falloff:disabled");
  expect(active.falloffSdfReads).toBeGreaterThan(active.falloffAffected);
  expect(active.falloffMaxDisplacement).toBeGreaterThan(0);
  expect(await geometrySignature(page)).not.toBe(baselineSignature);
  await capture(page, testInfo, "02-contour-falloff");

  await setRingFrequency(page, 1);
  const lowFrequency = await metrics(page);
  const lowFrequencySignature = await geometrySignature(page);
  await capture(page, testInfo, "03-ring-frequency-low");

  await setRingFrequency(page, 10);
  const highFrequency = await metrics(page);
  const highFrequencySignature = await geometrySignature(page);
  expect(highFrequency.falloffKey).not.toBe(lowFrequency.falloffKey);
  expect(highFrequency.rendererKey).not.toBe(lowFrequency.rendererKey);
  expect(highFrequencySignature).not.toBe(lowFrequencySignature);
  await capture(page, testInfo, "04-ring-frequency-high");

  await openAccordion(page, "Emitter Micro Response");
  await page.getByTestId("emitter-micro-enabled").check();
  await page.getByTestId("emitter-micro-occupancy").selectOption("exclude-interior");
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "micro/exclude-interior");
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-final-footprint-violations", "0");
  await expect.poll(async () => (await metrics(page)).finalExterior).toBeGreaterThan(0);
  const occupiedSvg = await metrics(page);
  const occupiedSignature = await geometrySignature(page);
  const probe = await footprintProbe(page);
  expect(probe.glyphPaths).toBeGreaterThan(0);
  expect(probe.marks).toBe(occupiedSvg.elementCount);
  expect(probe.violations).toBe(0);
  expect(occupiedSvg.finalFootprintViolations).toBe(0);
  await capture(page, testInfo, "05-micro-response-exclude-interior");

  await setPreviewBackend(page, "canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  const occupiedCanvas = await metrics(page);
  expect(occupiedCanvas.rendererKey).toBe(occupiedSvg.rendererKey);
  expect(occupiedCanvas.falloffKey).toBe(occupiedSvg.falloffKey);
  expect(occupiedCanvas.elementCount).toBe(occupiedSvg.elementCount);
  expect(occupiedCanvas.finalFootprintViolations).toBe(0);

  await setPreviewBackend(page, "svg-dom");
  await expect.poll(geometrySignature.bind(null, page)).toBe(occupiedSignature);
  await openPanel(page, "Export");
  await page.getByLabel("Numeric precision").selectOption("3");
  await waitForReady(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export SVG/ }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedSvg = readFileSync(downloadPath!, "utf8");
  const exported = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    const metadata = JSON.parse(document.querySelector("metadata")?.textContent ?? "{}");
    return {
      circleCount: document.querySelectorAll("#generated-artwork > circle").length,
      version: metadata.project?.version,
      falloff: metadata.project?.glyphFalloffDisplacement,
      occupancy: metadata.project?.emitterMicroResponse?.occupancy,
    };
  }, exportedSvg);
  expect(exportedSvg).not.toMatch(/<image\b|<canvas\b|<foreignObject\b/i);
  expect(exported.circleCount).toBe(occupiedSvg.elementCount);
  expect(exported.version).toBe(13);
  expect(exported.falloff).toMatchObject({ mode: "contour-rings", ringFrequency: 10 });
  expect(exported.occupancy).toBe("exclude-interior");
});
