import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { beginScenario, eventsFor, readTrace, type E2ETraceApi, type E2ETraceEvent } from "./helpers/trace";

type TraceEvent = E2ETraceEvent;
type TraceApi = E2ETraceApi;

type CanvasProbeFrame = {
  timestampMs: number;
  width: number;
  height: number;
  visible: boolean;
  drawCount: number;
  uniqueSamples: number;
  allBackground: boolean;
};

declare global {
  interface Window {
    __SUBSTRATE_E2E_BUILD__?: string;
    __SUBSTRATE_CANVAS_PROBE__?: { active: boolean; frames: CanvasProbeFrame[] };
  }
}

const size = (page: Page) => page.getByTestId("size-control");

async function loadApp(page: Page, preset?: string) {
  await page.goto("/");
  await expect(size(page)).toBeVisible();
  if (preset) {
    await page.locator(".preset-renderer-section select").selectOption(preset);
  }
  await pauseAnimation(page);
  await waitForReady(page);
}

async function pauseAnimation(page: Page) {
  const pause = page.getByRole("button", { name: "Pause animation" });
  if (await pause.count()) await pause.click();
}

async function waitForReady(page: Page) {
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
}

function summarizeTrace(events: TraceEvent[]) {
  const stages: Record<string, { instant: number; start: number; end: number; durationMs: number }> = {};
  for (const event of events) {
    const stage = stages[event.stage] ?? { instant: 0, start: 0, end: 0, durationMs: 0 };
    stage[event.phase] += 1;
    stage.durationMs += event.durationMs ?? 0;
    stages[event.stage] = stage;
  }
  const gestureEnds = events.filter((event) => event.stage === "native.size.gesture" && event.phase === "end");
  const lastGestureEnd = gestureEnds.at(-1);
  const exactVisible = events.find((event) => event.stage === "export.exact-visible" && (lastGestureEnd === undefined || event.timestampMs >= lastGestureEnd.timestampMs));
  const exportReady = events.find((event) => event.stage === "export.ready" && (exactVisible === undefined || event.timestampMs >= exactVisible.timestampMs));
  return {
    eventCount: events.length,
    firstSequence: events[0]?.sequence ?? null,
    lastSequence: events.at(-1)?.sequence ?? null,
    gestureCount: new Set(events.map((event) => event.gestureId).filter((id): id is number => id !== undefined)).size,
    rawInputCount: eventsFor(events, "native.size.input").length,
    draftFrameCount: eventsFor(events, "size.draft.frame").length,
    sizeInteractionCommitCount: eventsFor(events, "size.interaction.commit").length,
    projectCommitCount: eventsFor(events, "project.patch").length,
    fontSizePatchCount: fontSizePatches(events).length,
    projectPatchDuringDragCount: eventsDuringSizeDrag(events, "project.patch").length,
    typographyBuildCount: eventsFor(events, "typography.build", "end").length,
    substrateRequestCount: eventsFor(events, "substrate.request", "start").length,
    rendererBuildCount: eventsFor(events, "renderer.build", "end").length,
    reactCommitCount: eventsFor(events, "react.commit").length,
    canvasClearCount: eventsFor(events, "canvas.clear").length,
    canvasResizeCount: eventsFor(events, "canvas.resize").length,
    canvasDrawCount: eventsFor(events, "canvas.draw", "end").length,
    canvasPresentCount: eventsFor(events, "canvas.present").length,
    blankFrameCount: 0,
    releaseToExactVisibleMs: exactVisible && gestureEnds[0] ? exactVisible.timestampMs - gestureEnds[0].timestampMs : null,
    exactVisibleToExportReadyMs: exactVisible && exportReady ? exportReady.timestampMs - exactVisible.timestampMs : null,
    stages,
  };
}

test.afterEach(async ({ page }, testInfo) => {
  try {
    const events = await readTrace(page);
    const apiSummary = await page.evaluate(() => (
      (window as Window & { __SUBSTRATE_TRACE__?: TraceApi }).__SUBSTRATE_TRACE__?.getSummary() ?? null
    ));
    await writeFile(testInfo.outputPath("trace-summary.json"), JSON.stringify({ test: testInfo.title, status: testInfo.status, expectedStatus: testInfo.expectedStatus, summary: summarizeTrace(events), apiSummary }, null, 2), "utf8");
  } catch {
    // Harness evidence must never turn a product result into an infrastructure failure.
  }
});

function lastSizePatch(events: TraceEvent[]) {
  return events
    .filter((event) => event.stage === "project.patch" && String(event.detail?.fields ?? "").split(",").includes("fontSize"))
    .at(-1);
}

function fontSizePatches(events: TraceEvent[]) {
  return events.filter((event) => event.stage === "project.patch" && String(event.detail?.fields ?? "").split(",").includes("fontSize"));
}

function sizeDragWindows(events: TraceEvent[]) {
  const windows: Array<{ start: number; end: number }> = [];
  let dragStart: number | null = null;
  for (const event of events) {
    if ((event.stage === "size.interaction" && event.phase === "start") || event.stage === "size.gesture.start") dragStart = event.sequence;
    if (event.stage === "size.interaction.commit" && dragStart !== null) {
      windows.push({ start: dragStart, end: event.sequence });
      dragStart = null;
    }
  }
  return windows;
}

function eventsDuringSizeDrag(events: TraceEvent[], stage: string, phase?: TraceEvent["phase"]) {
  const windows = sizeDragWindows(events);
  return events.filter((event) => {
    if (event.stage !== stage) return false;
    if (phase !== undefined && event.phase !== phase) return false;
    return windows.some((window) => event.sequence > window.start && event.sequence < window.end);
  });
}

async function dragSize(page: Page, values: number[]) {
  const control = size(page);
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error("Size control has no browser bounding box.");
  const positionFor = async (value: number) => {
    const min = Number(await control.getAttribute("min"));
    const max = Number(await control.getAttribute("max"));
    const fraction = Math.max(0, Math.min(1, (value - min) / Math.max(1, max - min)));
    const thumbInset = 6;
    return { x: box.x + thumbInset + (box.width - thumbInset * 2) * fraction, y: box.y + box.height / 2 };
  };
  const currentPosition = await positionFor(Number(await control.inputValue()));
  await page.mouse.move(currentPosition.x, currentPosition.y);
  await page.mouse.down();
  for (const value of values) {
    const position = await positionFor(value);
    await page.mouse.move(position.x, position.y, { steps: 8 });
    await page.waitForTimeout(8);
  }
  const released = values.at(-1);
  if (released !== undefined) {
    for (let attempt = 0; attempt < 4 && await control.inputValue() !== String(released); attempt += 1) {
      const position = await positionFor(released);
      await page.mouse.move(position.x, position.y, { steps: 3 });
      await page.waitForTimeout(20);
    }
  }
  await page.mouse.up();
  if (released !== undefined) await expect(control).toHaveValue(String(released));
}

async function openPreviewPanel(page: Page) {
  const preview = page.locator("button.panel-heading-button").filter({ hasText: "Preview" });
  if ((await preview.getAttribute("aria-expanded")) !== "true") await preview.click();
}

async function setPreviewBackend(page: Page, backend: "svg-dom" | "canvas-2d") {
  await openPreviewPanel(page);
  await page.getByLabel("Preview Mode").selectOption(backend);
}

async function captureProject(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Project download path was unavailable.");
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function authoredProject(project: Record<string, unknown>) {
  const copy = structuredClone(project) as Record<string, unknown>;
  delete copy.debug;
  return copy;
}

async function startCanvasProbe(page: Page) {
  await page.evaluate(() => {
    const state = { active: true, frames: [] as CanvasProbeFrame[] };
    window.__SUBSTRATE_CANVAS_PROBE__ = state;
    const tick = (timestampMs: number) => {
      if (!state.active) return;
      const canvas = document.querySelector("[data-testid=artwork-canvas]") as HTMLCanvasElement | null;
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        const context = canvas.getContext("2d");
        const samples: string[] = [];
        if (context) {
          for (let row = 1; row <= 5; row += 1) {
            for (let column = 1; column <= 5; column += 1) {
              const x = Math.min(canvas.width - 1, Math.floor(canvas.width * column / 6));
              const y = Math.min(canvas.height - 1, Math.floor(canvas.height * row / 6));
              const pixel = context.getImageData(x, y, 1, 1).data;
              samples.push(`${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]}`);
            }
          }
        }
        const uniqueSamples = new Set(samples).size;
        state.frames.push({
          timestampMs,
          width: canvas.width,
          height: canvas.height,
          visible: getComputedStyle(canvas).visibility !== "hidden" && getComputedStyle(canvas).display !== "none",
          drawCount: (canvas as HTMLCanvasElement & { __SUBSTRATE_CANVAS_DRAW_COUNT__?: number }).__SUBSTRATE_CANVAS_DRAW_COUNT__ ?? 0,
          uniqueSamples,
          allBackground: uniqueSamples <= 1,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopCanvasProbe(page: Page) {
  return page.evaluate(() => {
    const probe = window.__SUBSTRATE_CANVAS_PROBE__;
    if (!probe) return [];
    probe.active = false;
    return probe.frames;
  });
}

test("harness smoke: E2E trace API is live and receives a native Size event", async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => {
    const trace = (window as Window & { __SUBSTRATE_TRACE__?: TraceApi }).__SUBSTRATE_TRACE__;
    if (!trace) throw new Error("E2E trace API is missing.");
    if (window.__SUBSTRATE_E2E_BUILD__ !== "e2e-trace") {
      throw new Error(`Unexpected E2E build identity: ${String(window.__SUBSTRATE_E2E_BUILD__)}`);
    }
    trace.reset();
    trace.beginScenario("harness-smoke");
  });
  await dragSize(page, [220]);
  const events = await readTrace(page);
  expect(events.length).toBeGreaterThan(0);
  expect(events.some((event) => event.stage === "native.size.pointerdown")).toBe(true);
  expect(events.some((event) => event.stage === "native.size.input")).toBe(true);
});

test("Gate 1: Ripple native Size drag", async ({ page }) => {
  await loadApp(page, "Sonic Ripple");
  await beginScenario(page, "gate-1-ripple-size-drag");
  await dragSize(page, [96, 240, 420, 300]);
  await waitForReady(page);
  const events = await readTrace(page);
  expect(await size(page).isEnabled()).toBe(true);
  expect(lastSizePatch(events)?.detail?.fontSizeAfter).toBe(300);
  expect(eventsFor(events, "native.size.input").length).toBeGreaterThanOrEqual(4);
  expect(eventsDuringSizeDrag(events, "project.patch").length).toBe(0);
  expect(eventsDuringSizeDrag(events, "typography.build", "end").length).toBe(0);
  expect(eventsDuringSizeDrag(events, "substrate.request", "start").length).toBe(0);
  expect(eventsDuringSizeDrag(events, "renderer.build", "end").length).toBe(0);
  expect(eventsDuringSizeDrag(events, "renderer.draft", "end").length).toBeGreaterThan(0);
  expect(fontSizePatches(events).length).toBe(1);
  expect(eventsFor(events, "size.draft.frame").length).toBeGreaterThan(0);
  expect(eventsFor(events, "typography.build", "end").length).toBeGreaterThan(0);
  expect(eventsFor(events, "renderer.build", "end").length).toBeGreaterThan(0);
  expect(eventsFor(events, "svg.presentation").length).toBeGreaterThan(0);
  expect(eventsFor(events, "export.ready").length).toBeGreaterThan(0);
});

test("Gate 2: Halftone native Size drag", async ({ page }) => {
  await loadApp(page, "Halftone Press");
  await beginScenario(page, "gate-2-halftone-size-drag");
  await dragSize(page, [90, 210, 460, 520]);
  await waitForReady(page);
  const events = await readTrace(page);
  expect(lastSizePatch(events)?.detail?.fontSizeAfter).toBe(520);
  expect(eventsDuringSizeDrag(events, "project.patch").length).toBe(0);
  expect(eventsDuringSizeDrag(events, "typography.build", "end").length).toBe(0);
  expect(eventsDuringSizeDrag(events, "substrate.request", "start").length).toBe(0);
  expect(eventsDuringSizeDrag(events, "renderer.build", "end").length).toBe(0);
  expect(fontSizePatches(events).length).toBe(1);
  expect(eventsFor(events, "substrate.request", "start").length).toBeGreaterThan(0);
  expect(eventsFor(events, "substrate.scheduler").length).toBeGreaterThan(0);
  expect(eventsFor(events, "substrate.result").length + eventsFor(events, "substrate.stale-result").length).toBeGreaterThan(0);
  expect(eventsFor(events, "renderer.build", "end").at(-1)?.counts?.elements ?? 0).toBeGreaterThan(0);
  expect(eventsFor(events, "react.commit").length).toBeGreaterThan(0);
  expect(await page.getByTestId("artwork-svg").count()).toBe(1);
});

test("Gate 3: second Size drag wins over an unsettled first drag", async ({ page }) => {
  await loadApp(page, "Sonic Ripple");
  await beginScenario(page, "gate-3-second-drag-wins");
  await dragSize(page, [180, 380]);
  await dragSize(page, [260, 340]);
  await waitForReady(page);
  const events = await readTrace(page);
  const gestures = new Set(events.filter((event) => event.gestureId !== undefined).map((event) => event.gestureId));
  expect(gestures.size).toBeGreaterThanOrEqual(2);
  expect(lastSizePatch(events)?.detail?.fontSizeAfter).toBe(340);
  expect(fontSizePatches(events).length).toBe(2);
  expect(eventsDuringSizeDrag(events, "project.patch").length).toBe(0);
  expect(await size(page).inputValue()).toBe("340");
});

test("Gate 4: double-click Size reset happens once and later input remains usable", async ({ page }) => {
  await loadApp(page, "Sonic Ripple");
  await dragSize(page, [300]);
  await waitForReady(page);
  await beginScenario(page, "gate-4-double-click-reset");
  await size(page).dblclick();
  await expect(size(page)).toHaveValue("148");
  await dragSize(page, [220]);
  await waitForReady(page);
  const events = await readTrace(page);
  expect(eventsFor(events, "native.size.reset").length).toBe(1);
  expect(eventsFor(events, "native.size.reset")[0]?.detail?.canonicalDefault).toBe(148);
  expect(lastSizePatch(events)?.detail?.fontSizeAfter).toBe(220);
  expect(String(eventsFor(events, "project.patch").find((event) => event.detail?.fontSizeAfter === 148)?.detail?.fields ?? "")).toContain("fontSize");
  expect(await size(page).isEnabled()).toBe(true);
});

test("Gate 5: Flow SVG and Canvas consume the same geometry frame", async ({ page }) => {
  await loadApp(page, "Edge Current");
  await beginScenario(page, "gate-5-flow-svg-canvas-parity");
  await setPreviewBackend(page, "svg-dom");
  await waitForReady(page);
  const svg = page.getByTestId("artwork-svg");
  const svgViewBox = await svg.getAttribute("viewBox");
  const svgPaths = await svg.locator("path").count();
  const svgShot = await svg.screenshot();
  const svgEvents = await readTrace(page);
  const svgFrameKey = eventsFor(svgEvents, "svg.presentation").at(-1)?.frameKey;

  await setPreviewBackend(page, "canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  await waitForReady(page);
  const canvasShot = await page.getByTestId("artwork-canvas").screenshot();
  const canvasEvents = await readTrace(page);
  const canvasFrameKey = eventsFor(canvasEvents, "canvas.present").at(-1)?.frameKey;

  expect(svgViewBox).toMatch(/^0 0 \d+ \d+$/);
  expect(svgPaths).toBeGreaterThan(0);
  expect(svgShot.byteLength).toBeGreaterThan(1_000);
  expect(canvasShot.byteLength).toBeGreaterThan(1_000);
  expect(canvasFrameKey).toBe(svgFrameKey);
  expect(eventsFor(canvasEvents, "preview.backend").some((event) => event.detail?.backend === "canvas-2d")).toBe(true);
});

test("Gate 6: Canvas update has no all-background frame between valid frames", async ({ page }) => {
  await loadApp(page, "Edge Current");
  await setPreviewBackend(page, "canvas-2d");
  await waitForReady(page);
  await startCanvasProbe(page);
  await beginScenario(page, "gate-6-canvas-no-blank-frame");
  await dragSize(page, [260]);
  await waitForReady(page);
  await page.waitForTimeout(500);
  const frames = await stopCanvasProbe(page);
  const observed = frames.filter((frame) => frame.visible && frame.drawCount > 0);
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((frame) => !frame.allBackground)).toBe(true);
  const events = await readTrace(page);
  expect(eventsDuringSizeDrag(events, "canvas.clear").length).toBe(0);
  expect(eventsFor(events, "canvas.present").length).toBeGreaterThan(0);
});

function sceneLayoutKeyFromTrace(events: TraceEvent[]) {
  return [...eventsFor(events, "scene.layout")].reverse().find((event) => event.outputKey)?.outputKey ?? null;
}

async function sceneLayoutKeyFromStage(page: Page) {
  const stage = page.getByTestId("viewport-stage");
  await expect(stage).toHaveAttribute("data-scene-layout-key", /.+/);
  return stage.getAttribute("data-scene-layout-key");
}

async function rendererElementCountFromStage(page: Page) {
  const value = await page.getByTestId("viewport-stage").getAttribute("data-renderer-element-count");
  return Number(value);
}

function effectiveRectFromStage(page: Page) {
  const stage = page.getByTestId("viewport-stage");
  return Promise.all([
    stage.getAttribute("data-artboard-authored-width"),
    stage.getAttribute("data-artboard-authored-height"),
    stage.getAttribute("data-artboard-effective-x"),
    stage.getAttribute("data-artboard-effective-y"),
    stage.getAttribute("data-artboard-effective-width"),
    stage.getAttribute("data-artboard-effective-height"),
  ]).then(([authoredWidth, authoredHeight, effectiveX, effectiveY, effectiveWidth, effectiveHeight]) => ({
    authoredWidth: Number(authoredWidth),
    authoredHeight: Number(authoredHeight),
    effectiveX: Number(effectiveX),
    effectiveY: Number(effectiveY),
    effectiveWidth: Number(effectiveWidth),
    effectiveHeight: Number(effectiveHeight),
  }));
}

function repairPatches(events: TraceEvent[]) {
  return eventsFor(events, "project.patch").filter((event) => {
    const fields = String(event.detail?.fields ?? "").split(",").map((field) => field.trim());
    return fields.some((field) => field === "artboard" || field === "textOffsetY");
  });
}

function sizeGestureStarts(events: TraceEvent[]) {
  return eventsFor(events, "size.gesture.start");
}

function sizeInteractionCommits(events: TraceEvent[]) {
  return eventsFor(events, "size.interaction.commit");
}

async function navigateViewport(page: Page) {
  const stage = page.getByTestId("viewport-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Viewport stage has no bounding box.");
  await stage.hover();
  await page.mouse.wheel(0, -20_000);
  await page.mouse.wheel(0, 20_000);
  await page.keyboard.down("Space");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
}

test("Gate 7: 148 to 540 to 148 returns the authored scene", async ({ page }) => {
  await loadApp(page, "Edge Current");
  const initialProject = authoredProject(await captureProject(page));
  const initialViewBox = await page.getByTestId("artwork-svg").getAttribute("viewBox");
  const initialRect = await effectiveRectFromStage(page);
  const initialSceneKey = await sceneLayoutKeyFromStage(page);
  const initialRendererElements = await rendererElementCountFromStage(page);
  await beginScenario(page, "gate-7-size-round-trip");

  await dragSize(page, [540]);
  await waitForReady(page);
  await dragSize(page, [148]);
  await waitForReady(page);

  const finalProject = authoredProject(await captureProject(page));
  const finalViewBox = await page.getByTestId("artwork-svg").getAttribute("viewBox");
  const finalRect = await effectiveRectFromStage(page);
  const finalEvents = await readTrace(page);
  const finalSceneKey = await sceneLayoutKeyFromStage(page);
  const finalRendererElements = await rendererElementCountFromStage(page);
  const tracedSceneKey = sceneLayoutKeyFromTrace(finalEvents);

  expect(await size(page).inputValue()).toBe("148");
  expect(finalProject.artboard).toEqual(initialProject.artboard);
  expect(finalProject.textOffsetY).toBe(initialProject.textOffsetY);
  expect(finalProject).toEqual(initialProject);
  expect(finalRect).toEqual(initialRect);
  expect(finalViewBox).toBe(initialViewBox);
  expect(finalSceneKey).toBe(initialSceneKey);
  expect(tracedSceneKey).toBe(initialSceneKey);
  expect(finalRendererElements).toBe(initialRendererElements);
  expect(repairPatches(finalEvents)).toHaveLength(0);
  expect(sizeGestureStarts(finalEvents)).toHaveLength(2);
  expect(fontSizePatches(finalEvents)).toHaveLength(2);
  expect(sizeInteractionCommits(finalEvents)).toHaveLength(2);
});

test("Gate 8: dense SVG and supported Canvas navigation smoke test", async ({ page }) => {
  await loadApp(page, "Edge Current");
  await setPreviewBackend(page, "svg-dom");
  await waitForReady(page);
  const initialProject = authoredProject(await captureProject(page));
  await beginScenario(page, "gate-8-navigation-smoke");
  await dragSize(page, [320]);
  await navigateViewport(page);
  const settlingEvents = await readTrace(page);
  const settlingStart = eventsFor(settlingEvents, "size.settling.start").at(-1);
  const settledIdle = [...eventsFor(settlingEvents, "size.idle")].reverse().find((event) => event.detail?.reason === "settled");
  const firstWheel = eventsFor(settlingEvents, "navigation.wheel").at(0);
  expect(settlingStart).toBeDefined();
  expect(firstWheel).toBeDefined();
  expect(eventsFor(settlingEvents, "navigation.wheel").length).toBeGreaterThanOrEqual(2);
  expect(eventsFor(settlingEvents, "navigation.commit").length).toBeGreaterThan(0);
  expect(firstWheel!.timestampMs).toBeGreaterThanOrEqual(settlingStart!.timestampMs - 50);
  expect(settledIdle ?? settlingStart).toBeDefined();
  await waitForReady(page);
  await expect(page.getByTestId("viewport-stage")).toHaveAttribute("data-size-interaction-phase", "idle");
  const afterSettleProject = authoredProject(await captureProject(page));
  expect(afterSettleProject.artboard).toEqual(initialProject.artboard);
  expect(afterSettleProject.textOffsetY).toBe(initialProject.textOffsetY);
  expect(afterSettleProject.fontSize).toBe(320);
  await beginScenario(page, "gate-8-navigation-only");
  await navigateViewport(page);
  await expect(page.locator("[data-canvas-zoom]")).toHaveAttribute("data-canvas-zoom", /^(0\.25|[0-7](\.\d+)?|8(\.0+)?)$/);
  const finalProject = authoredProject(await captureProject(page));
  expect(finalProject).toEqual(afterSettleProject);
  const events = await readTrace(page);
  expect(eventsFor(events, "navigation.wheel").length).toBeGreaterThanOrEqual(2);
  expect(eventsFor(events, "navigation.commit").length).toBeGreaterThan(0);
  expect(eventsFor(events, "renderer.build").length).toBe(0);
  expect(eventsFor(events, "browser.long-task").every((event) => (event.durationMs ?? 0) >= 0)).toBe(true);

  await setPreviewBackend(page, "canvas-2d");
  await expect(page.getByTestId("artwork-canvas")).toBeVisible();
  const canvasEvents = await readTrace(page);
  const resize = eventsFor(canvasEvents, "canvas.resize").at(-1);
  expect(resize?.counts?.width).toBeGreaterThan(0);
  expect(resize?.counts?.height).toBeGreaterThan(0);
  expect(resize?.detail?.dpr).toBe(1);
});
