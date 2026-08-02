import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const legacyFixture = resolve("tests/fixtures/projects/legacy/private-sonics-v8.substrate.json");
const parsedFontFixture = resolve("tests/fixtures/Basic-Regular.ttf");
const occupancyEvidenceDir = process.env.OCCUPANCY_EVIDENCE_DIR;
const stage = (page: Page) => page.getByTestId("viewport-stage");

async function openPanel(page: Page, name: string) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function openMicroResponse(page: Page) {
  const button = page.locator("button.accordion-summary").filter({ hasText: "Emitter Micro Response" });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function waitForReady(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", "ready", { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute("data-text-geometry-key", /.+/, { timeout: 60_000 });
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
  await expect(page.locator('[aria-label="Renderer"] button.active')).toContainText("Glyph Diffuser");
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  await expect(page.getByTestId("project-message")).toContainText("loaded", { timeout: 60_000 });
  await waitForReady(page);
  await pinSvgPreview(page);
  await openMicroResponse(page);
}

async function setMicroRange(page: Page, label: string, value: number) {
  const input = page.locator(".emitter-micro-response label.range")
    .filter({ hasText: label })
    .locator('input[type="range"]');
  await input.fill(String(value));
}

type CircleSample = { x: number; y: number; radius: number; signature: string };

async function circles(page: Page): Promise<CircleSample[]> {
  return page.locator("#generated-artwork > circle").evaluateAll((nodes) => nodes.map((node) => {
    const x = Number(node.getAttribute("cx"));
    const y = Number(node.getAttribute("cy"));
    const radius = Number(node.getAttribute("r"));
    return {
      x,
      y,
      radius,
      signature: [
        node.getAttribute("cx"),
        node.getAttribute("cy"),
        node.getAttribute("r"),
        node.getAttribute("opacity"),
      ].join(","),
    };
  }));
}

async function circleSignature(page: Page) {
  return (await circles(page)).map((circle) => circle.signature).join("|");
}

async function overlaySignature(page: Page) {
  return page.locator(".diffuser-text-overlay path").evaluateAll((paths) => (
    paths.map((path) => path.getAttribute("d") ?? "").join("|")
  ));
}

async function snapshot(page: Page) {
  return stage(page).evaluate((node) => ({
    rendererKey: node.getAttribute("data-renderer-key") ?? "",
    domainKey: node.getAttribute("data-glyph-domain-key") ?? "",
    substrateKey: node.getAttribute("data-substrate-key") ?? "",
    microKey: node.getAttribute("data-emitter-micro-key") ?? "",
    sceneKey: node.getAttribute("data-scene-layout-key") ?? "",
    bounds: node.getAttribute("data-renderer-output-bounds") ?? "",
    effectiveRect: [
      node.getAttribute("data-artboard-effective-x"),
      node.getAttribute("data-artboard-effective-y"),
      node.getAttribute("data-artboard-effective-width"),
      node.getAttribute("data-artboard-effective-height"),
    ].join(","),
    count: Number(node.getAttribute("data-renderer-element-count")),
    anchorX: Number(node.getAttribute("data-emitter-anchor-x")),
    anchorY: Number(node.getAttribute("data-emitter-anchor-y")),
    affected: Number(node.getAttribute("data-emitter-micro-affected")),
    adjusted: Number(node.getAttribute("data-emitter-micro-adjusted")),
    interior: Number(node.getAttribute("data-emitter-micro-interior")),
    invalid: Number(node.getAttribute("data-emitter-micro-footprint-invalid")),
    relocated: Number(node.getAttribute("data-emitter-micro-relocated")),
    rejected: Number(node.getAttribute("data-emitter-micro-rejected")),
    finalExterior: Number(node.getAttribute("data-emitter-micro-final-exterior")),
    finalFootprintViolations: Number(node.getAttribute("data-emitter-micro-final-footprint-violations")),
    occupancyDomain: node.getAttribute("data-emitter-micro-occupancy-domain") ?? "",
    sealedCounterPixels: Number(node.getAttribute("data-emitter-micro-sealed-counter-pixels")),
    sdfReads: Number(node.getAttribute("data-emitter-micro-sdf-reads")),
  }));
}

async function footprintProbe(page: Page) {
  return page.evaluate(() => {
    const glyphPaths = [...document.querySelectorAll<SVGGeometryElement>("#substrate-mask path")];
    const marks = [...document.querySelectorAll<SVGCircleElement>("#generated-artwork > circle")];
    let tested = 0;
    let violations = 0;
    let centerInside = 0;

    for (const mark of marks) {
      const x = Number(mark.getAttribute("cx"));
      const y = Number(mark.getAttribute("cy"));
      const markRadius = Number(mark.getAttribute("r"));
      tested += 1;
      const points = [new DOMPoint(x, y)];
      if (glyphPaths.some((path) => path.isPointInFill(points[0]))) centerInside += 1;
      for (let index = 0; index < 96; index += 1) {
        const angle = index / 96 * Math.PI * 2;
        points.push(new DOMPoint(
          x + Math.cos(angle) * (markRadius + 0.01),
          y + Math.sin(angle) * (markRadius + 0.01),
        ));
      }
      if (points.some((point) => glyphPaths.some((path) => path.isPointInFill(point)))) {
        violations += 1;
      }
    }
    return { tested, violations, centerInside, glyphPaths: glyphPaths.length };
  });
}

async function counterProbe(page: Page) {
  return page.evaluate(() => {
    const counterPath = document.querySelector<SVGGeometryElement>(
      '#substrate-mask path[data-character-index="9"]',
    );
    const stageNode = document.querySelector<HTMLElement>('[data-testid="viewport-stage"]');
    const anchorX = Number(stageNode?.getAttribute("data-emitter-anchor-x"));
    const anchorY = Number(stageNode?.getAttribute("data-emitter-anchor-y"));
    if (!counterPath || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
      return { glyphFound: false, innerRadius: 0, centerProbeParticleCount: 0, counterMarks: 0 };
    }
    const bounds = counterPath.getBBox();
    const maximumSearch = Math.hypot(bounds.width, bounds.height);
    const boundaryDistances: number[] = [];
    for (let ray = 0; ray < 96; ray += 1) {
      const angle = ray / 96 * Math.PI * 2;
      for (let distance = 0.5; distance <= maximumSearch; distance += 0.5) {
        const point = new DOMPoint(
          anchorX + Math.cos(angle) * distance,
          anchorY + Math.sin(angle) * distance,
        );
        if (counterPath.isPointInFill(point)) {
          boundaryDistances.push(distance);
          break;
        }
      }
    }
    const innerRadius = boundaryDistances.length > 0 ? Math.min(...boundaryDistances) : 0;
    const marks = [...document.querySelectorAll<SVGCircleElement>("#generated-artwork > circle")];
    let centerProbeParticleCount = 0;
    let counterMarks = 0;
    for (const mark of marks) {
      const x = Number(mark.getAttribute("cx"));
      const y = Number(mark.getAttribute("cy"));
      if (counterPath.isPointInFill(new DOMPoint(x, y))) continue;
      const distance = Math.hypot(x - anchorX, y - anchorY);
      if (distance < innerRadius * 0.5) centerProbeParticleCount += 1;
      const steps = Math.max(16, Math.ceil(distance / 2));
      let connectedToCounter = true;
      for (let step = 1; step <= steps; step += 1) {
        const amount = step / steps;
        if (counterPath.isPointInFill(new DOMPoint(
          anchorX + (x - anchorX) * amount,
          anchorY + (y - anchorY) * amount,
        ))) {
          connectedToCounter = false;
          break;
        }
      }
      if (connectedToCounter) {
        counterMarks += 1;
      }
    }
    return { glyphFound: true, innerRadius, centerProbeParticleCount, counterMarks };
  });
}

async function attachStage(page: Page, testInfo: TestInfo, name: string) {
  const body = await stage(page).screenshot();
  await testInfo.attach(name, {
    body,
    contentType: "image/png",
  });
  if (occupancyEvidenceDir && name.startsWith("occupancy-")) {
    mkdirSync(occupancyEvidenceDir, { recursive: true });
    writeFileSync(resolve(occupancyEvidenceDir, `${name}.png`), body);
  }
}

function writeOccupancyEvidence(value: unknown) {
  if (!occupancyEvidenceDir) return;
  mkdirSync(occupancyEvidenceDir, { recursive: true });
  writeFileSync(resolve(occupancyEvidenceDir, "metrics.json"), `${JSON.stringify(value, null, 2)}\n`);
}

async function saveProject(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Project download path was unavailable.");
  return { path, document: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> };
}

test("Emitter Micro Response legacy, locality, occupancy, parity, and disable gates", async ({ page }, testInfo) => {
  await loadPrivateSonics(page);
  await expect(stage(page)).toHaveAttribute("data-artboard-authored-width", "1200");
  await expect(stage(page)).toHaveAttribute("data-artboard-authored-height", "720");
  await expect(stage(page)).toHaveAttribute("data-glyph-displacement-key", "disabled");
  await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "false");
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "disabled");

  const baseline = await snapshot(page);
  const baselineCircles = await circles(page);
  const baselineSignature = baselineCircles.map((circle) => circle.signature).join("|");
  const baselineOverlay = await overlaySignature(page);
  expect(baseline.count).toBeGreaterThan(0);
  expect(baselineOverlay.length).toBeGreaterThan(0);
  await attachStage(page, testInfo, "01-private-sonics-v8-baseline");

  await page.getByTestId("emitter-micro-enabled").check();
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "micro/legacy");
  await setMicroRange(page, "Response radius", 320);
  await setMicroRange(page, "Position detail", 68);
  await setMicroRange(page, "Density breakup", 20);
  await setMicroRange(page, "Detail scale", 10);
  await setMicroRange(page, "Max displacement", 20);
  await expect.poll(async () => (await snapshot(page)).adjusted).toBeGreaterThan(0);
  const micro = await snapshot(page);
  const legacyProbe = await footprintProbe(page);
  const legacyCounter = await counterProbe(page);
  expect(micro.rendererKey).not.toBe(baseline.rendererKey);
  expect(micro.affected).toBeGreaterThan(0);
  expect(legacyProbe.violations).toBeGreaterThan(0);
  expect(legacyCounter.innerRadius).toBeGreaterThan(0);
  expect(legacyCounter.centerProbeParticleCount).toBeGreaterThan(0);
  expect(legacyCounter.counterMarks).toBeGreaterThan(0);
  expect(await overlaySignature(page)).toBe(baselineOverlay);
  await attachStage(page, testInfo, "occupancy-01-legacy");

  await page.getByTestId("emitter-micro-occupancy").selectOption("exclude-interior");
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "micro/exclude-interior");
  const occupancyEnabled = page.getByTestId("emitter-micro-occupancy-enabled");
  await expect(occupancyEnabled).toBeChecked();
  await occupancyEnabled.uncheck();
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-occupancy-domain", "legacy-glyph-ink");
  await expect.poll(async () => (await counterProbe(page)).counterMarks).toBeGreaterThan(0);
  await occupancyEnabled.check();
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "micro/exclude-interior");
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-occupancy-domain", "sealed-glyph-silhouette");
  await expect.poll(async () => (await counterProbe(page)).counterMarks).toBe(0);
  await expect.poll(async () => (await snapshot(page)).invalid).toBeGreaterThan(0);
  const excluded = await snapshot(page);
  const excludedProbe = await footprintProbe(page);
  const excludedCounter = await counterProbe(page);
  expect(excluded.relocated).toBe(0);
  expect(excluded.rejected).toBeGreaterThan(0);
  expect(excluded.finalExterior).toBeGreaterThan(0);
  expect(excluded.finalFootprintViolations).toBe(0);
  expect(excluded.occupancyDomain).toBe("sealed-glyph-silhouette");
  expect(excluded.sealedCounterPixels).toBeGreaterThan(0);
  expect(excludedProbe.glyphPaths).toBeGreaterThan(0);
  expect(excludedProbe.tested).toBeGreaterThan(0);
  expect(excludedProbe.violations).toBe(0);
  expect(excludedCounter).toMatchObject({ glyphFound: true });
  expect(excludedCounter.innerRadius).toBeGreaterThan(0);
  expect(excludedCounter.centerProbeParticleCount).toBe(0);
  expect(excludedCounter.counterMarks).toBe(0);
  expect(await overlaySignature(page)).toBe(baselineOverlay);
  expect(Number(excluded.effectiveRect.split(",")[0])).toBeLessThan(0);
  expect(Number(excluded.effectiveRect.split(",")[1])).toBeLessThan(0);
  await attachStage(page, testInfo, "occupancy-02-exclude-interior");

  const excludedSignature = await circleSignature(page);
  await page.getByTestId("emitter-micro-occupancy").selectOption("disperse-exterior");
  await setMicroRange(page, "Exterior push", 68);
  await setMicroRange(page, "Tangential flow", 38);
  await setMicroRange(page, "Divergence", 22);
  await setMicroRange(page, "Exterior shell", 52);
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "micro/disperse-exterior");
  await expect.poll(async () => (await snapshot(page)).relocated).toBeGreaterThan(0);
  const dispersed = await snapshot(page);
  const dispersedProbe = await footprintProbe(page);
  const dispersedCounter = await counterProbe(page);
  expect(await circleSignature(page)).not.toBe(excludedSignature);
  expect(dispersed.interior).toBeGreaterThan(0);
  expect(dispersed.relocated / dispersed.interior).toBeGreaterThan(0.05);
  expect(dispersed.finalExterior).toBeGreaterThan(0);
  expect(dispersed.finalFootprintViolations).toBe(0);
  expect(dispersed.occupancyDomain).toBe("sealed-glyph-silhouette");
  expect(dispersed.sdfReads).toBeGreaterThan(0);
  expect(dispersed.count).toBeGreaterThanOrEqual(excluded.count);
  expect(dispersedProbe.tested).toBeGreaterThan(0);
  expect(dispersedProbe.violations).toBe(0);
  expect(dispersedCounter.counterMarks).toBe(0);
  expect(dispersedCounter.centerProbeParticleCount).toBe(0);
  expect(await overlaySignature(page)).toBe(baselineOverlay);
  await attachStage(page, testInfo, "occupancy-03-disperse-exterior");

  await page.getByTestId("glyph-micro-warp-enabled").check();
  await page.getByTestId("glyph-micro-warp-strength").fill("100");
  await page.getByTestId("glyph-micro-warp-radius").fill("220");
  await page.getByTestId("glyph-micro-warp-detail-scale").fill("12");
  await page.getByTestId("glyph-micro-warp-normal").fill("100");
  await page.getByTestId("glyph-micro-warp-tangent").fill("24");
  await page.getByTestId("glyph-micro-warp-max").fill("30");
  await waitForReady(page);
  await expect(stage(page)).toHaveAttribute("data-glyph-micro-warp-active", "true");
  await expect.poll(async () => (await snapshot(page)).domainKey).not.toBe(dispersed.domainKey);
  const warpedDispersed = await snapshot(page);
  const warpedProbe = await footprintProbe(page);
  const warpedCounter = await counterProbe(page);
  expect(warpedDispersed.relocated).toBeGreaterThan(0);
  expect(warpedDispersed.finalFootprintViolations).toBe(0);
  expect(warpedDispersed.substrateKey).not.toBe(dispersed.substrateKey);
  expect(warpedDispersed.microKey).toContain(warpedDispersed.substrateKey);
  expect(warpedProbe.tested).toBeGreaterThan(0);
  expect(warpedProbe.violations).toBe(0);
  expect(warpedCounter.counterMarks).toBe(0);
  expect(warpedCounter.centerProbeParticleCount).toBe(0);
  await attachStage(page, testInfo, "occupancy-04-glyph-micro-warp-plus-disperse");
  writeOccupancyEvidence({
    fixture: "Private / Sonics",
    font: "Basic-Regular.ttf",
    shared: {
      typography: "Private\\nSonics",
      seed: 38147,
      renderer: "glyph-diffuser",
      responseRadius: 320,
      positionDetail: 68,
      densityBreakup: 20,
      detailScale: 10,
      maxDisplacement: 20,
      exteriorPush: 68,
      tangentialFlow: 38,
      divergence: 22,
      exteriorShell: 52,
      keepCountersClear: true,
    },
    states: [
      {
        state: "Legacy occupancy",
        screenshot: "occupancy-01-legacy.png",
        ...micro,
        initiallyInside: legacyProbe.centerInside,
        footprintViolationCount: legacyProbe.violations,
        counterMarkCount: legacyCounter.counterMarks,
        counterCenterParticleCount: legacyCounter.centerProbeParticleCount,
        exactSdfGateApplied: false,
      },
      {
        state: "Exclude interior",
        screenshot: "occupancy-02-exclude-interior.png",
        ...excluded,
        initiallyInside: excluded.interior,
        footprintViolationCount: excludedProbe.violations,
        counterMarkCount: excludedCounter.counterMarks,
        counterCenterParticleCount: excludedCounter.centerProbeParticleCount,
        exactSdfGateApplied: true,
      },
      {
        state: "Disperse exterior",
        screenshot: "occupancy-03-disperse-exterior.png",
        ...dispersed,
        initiallyInside: dispersed.interior,
        footprintViolationCount: dispersedProbe.violations,
        counterMarkCount: dispersedCounter.counterMarks,
        counterCenterParticleCount: dispersedCounter.centerProbeParticleCount,
        exactSdfGateApplied: true,
      },
      {
        state: "Glyph Micro Warp + Disperse exterior",
        screenshot: "occupancy-04-glyph-micro-warp-plus-disperse.png",
        ...warpedDispersed,
        initiallyInside: warpedDispersed.interior,
        footprintViolationCount: warpedProbe.violations,
        counterMarkCount: warpedCounter.counterMarks,
        counterCenterParticleCount: warpedCounter.centerProbeParticleCount,
        exactSdfGateApplied: true,
      },
    ],
  });

  const svgSignature = await circleSignature(page);
  const svgSnapshot = await snapshot(page);
  await openPanel(page, "Preview");
  await page.getByLabel("Preview Mode").selectOption("canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  const canvasSnapshot = await snapshot(page);
  expect(canvasSnapshot).toEqual(svgSnapshot);
  await attachStage(page, testInfo, "05-canvas-parity");
  await page.getByLabel("Preview Mode").selectOption("svg-dom");
  await expect.poll(circleSignature.bind(null, page)).toBe(svgSignature);

  await openPanel(page, "Export");
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export SVG/ }).click();
  const exportDownload = await exportPromise;
  const exportPath = await exportDownload.path();
  if (!exportPath) throw new Error("SVG export download path was unavailable.");
  const exportedSvg = readFileSync(exportPath, "utf8");
  const artwork = exportedSvg.match(/<g id="generated-artwork"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? "";
  expect(artwork.match(/<circle\b/g)?.length ?? 0).toBe(svgSnapshot.count);
  expect(artwork).not.toMatch(/<image\b|<canvas\b|<foreignObject\b|data:image|;base64,/i);
  expect(exportedSvg).toContain(`viewBox="${svgSnapshot.effectiveRect.replaceAll(",", " ")}"`);
  await attachStage(page, testInfo, "06-vector-export-parity");

  await page.getByTestId("emitter-micro-occupancy").selectOption("legacy");
  await page.getByTestId("emitter-micro-enabled").uncheck();
  await page.getByTestId("glyph-micro-warp-enabled").uncheck();
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "disabled");
  await expect.poll(circleSignature.bind(null, page)).toBe(baselineSignature);
  const restored = await snapshot(page);
  expect(restored.rendererKey).toBe(baseline.rendererKey);
  expect(restored.sceneKey).toBe(baseline.sceneKey);
  expect(restored.bounds).toBe(baseline.bounds);
  expect(restored.effectiveRect).toBe(baseline.effectiveRect);
  expect(restored.count).toBe(baseline.count);
  await attachStage(page, testInfo, "07-exact-disable-restoration");

  const firstSave = await saveProject(page);
  expect(firstSave.document).toMatchObject({
    version: 12,
    text: "Private\nSonics",
    renderer: "glyph-diffuser",
    artboard: { width: 1200, height: 720 },
    glyphDisplacement: { enabled: false },
    displayDislocation: { enabled: false },
    emitterMicroResponse: { enabled: false, occupancy: "legacy" },
    glyphMicroWarp: { enabled: false },
  });
  await page.locator('input[type="file"][accept*="application/json"]').setInputFiles(firstSave.path);
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  await waitForReady(page);
  await expect.poll(circleSignature.bind(null, page)).toBe(baselineSignature);
  const secondSave = await saveProject(page);
  expect(secondSave.document).toEqual(firstSave.document);
});

test("Display Dislocation retains coarse regions while microdetail composes and restores exactly", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Preset").selectOption("Display Dislocation");
  await waitForReady(page);
  await pinSvgPreview(page);
  await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "true");
  const baselineSignature = await circleSignature(page);
  const baseline = await stage(page).evaluate((node) => ({
    rendererKey: node.getAttribute("data-renderer-key"),
    regions: node.getAttribute("data-display-dislocation-regions"),
    affected: node.getAttribute("data-display-dislocation-affected"),
    mode: node.getAttribute("data-display-dislocation-mode"),
  }));

  await openMicroResponse(page);
  await page.getByTestId("emitter-micro-enabled").check();
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "micro/legacy");
  await setMicroRange(page, "Response radius", 232);
  await setMicroRange(page, "Position detail", 62);
  await setMicroRange(page, "Density breakup", 0);
  await setMicroRange(page, "Detail scale", 8);
  await setMicroRange(page, "Max displacement", 12);
  await expect.poll(async () => (await snapshot(page)).adjusted).toBeGreaterThan(0);
  const composedSignature = await circleSignature(page);
  const composed = await stage(page).evaluate((node) => ({
    rendererKey: node.getAttribute("data-renderer-key"),
    regions: node.getAttribute("data-display-dislocation-regions"),
    affected: node.getAttribute("data-display-dislocation-affected"),
    mode: node.getAttribute("data-display-dislocation-mode"),
  }));
  expect(composedSignature).not.toBe(baselineSignature);
  expect(composed.rendererKey).not.toBe(baseline.rendererKey);
  expect(composed.regions).toBe(baseline.regions);
  expect(composed.affected).toBe(baseline.affected);
  expect(composed.mode).toBe(baseline.mode);
  await attachStage(page, testInfo, "08-display-dislocation-plus-microdetail");

  await page.getByTestId("emitter-micro-occupancy").selectOption("disperse-exterior");
  await setMicroRange(page, "Exterior push", 68);
  await setMicroRange(page, "Tangential flow", 38);
  await setMicroRange(page, "Divergence", 22);
  await setMicroRange(page, "Exterior shell", 48);
  await expect.poll(async () => (await snapshot(page)).relocated).toBeGreaterThan(0);
  const occupied = await snapshot(page);
  const occupiedProbe = await footprintProbe(page);
  expect(occupied.finalFootprintViolations).toBe(0);
  expect(occupiedProbe.tested).toBeGreaterThan(0);
  expect(occupiedProbe.violations).toBe(0);
  await attachStage(page, testInfo, "09-display-dislocation-plus-occupancy");

  await page.getByTestId("emitter-micro-occupancy").selectOption("legacy");
  await page.getByTestId("emitter-micro-enabled").uncheck();
  await expect(stage(page)).toHaveAttribute("data-emitter-micro-mode", "disabled");
  await expect.poll(circleSignature.bind(null, page)).toBe(baselineSignature);
  await expect(stage(page)).toHaveAttribute("data-renderer-key", baseline.rendererKey ?? "");
});
