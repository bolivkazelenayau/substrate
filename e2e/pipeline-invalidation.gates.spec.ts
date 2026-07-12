import { expect, test, type Page } from "@playwright/test";
import { authoritativeEventsFor, beginScenario, eventsFor, readTrace, type E2ETraceEvent } from "./helpers/trace";

async function loadApp(page: Page, preset = "Edge Current") {
  await page.goto("/");
  await expect(page.getByTestId("size-control")).toBeVisible();
  await page.locator(".preset-renderer-section select").selectOption(preset);
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
}

async function dragSize(page: Page, value: number) {
  const control = page.getByTestId("size-control");
  const box = await control.boundingBox();
  if (!box) throw new Error("Size control has no bounding box.");
  const min = Number(await control.getAttribute("min"));
  const max = Number(await control.getAttribute("max"));
  const fraction = Math.max(0, Math.min(1, (value - min) / Math.max(1, max - min)));
  const x = box.x + 6 + (box.width - 12) * fraction;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await expect(control).toHaveValue(String(value));
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
}

async function navigateViewport(page: Page) {
  const stage = page.getByTestId("viewport-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Viewport stage has no bounding box.");
  await stage.hover();
  await page.mouse.wheel(0, -10_000);
  await page.mouse.wheel(0, 10_000);
}

test("Gate A: Flow authoritative commit schedules zero substrate work", async ({ page }) => {
  await loadApp(page, "Sonic Ripple");
  await beginScenario(page, "gate-a-flow-authoritative");
  await dragSize(page, 300);
  const events = await readTrace(page);
  expect(eventsFor(events, "project.patch").filter((event) => String(event.detail?.fields ?? "").includes("fontSize")).length).toBe(1);
  expect(eventsFor(events, "substrate.request", "start").length).toBe(0);
  expect(eventsFor(events, "substrate.compute", "start").length).toBe(0);
  expect(eventsFor(events, "renderer.build", "end").length).toBeGreaterThan(0);
  expect(eventsFor(events, "export.ready").length).toBeGreaterThan(0);
});

test("Gate B: Halftone authoritative commit requests substrate once", async ({ page }) => {
  await loadApp(page, "Halftone Press");
  await beginScenario(page, "gate-b-halftone-authoritative");
  await dragSize(page, 420);
  const events = await readTrace(page);
  expect(eventsFor(events, "substrate.request", "start").length).toBeGreaterThan(0);
  expect(eventsFor(events, "renderer.build", "end").length).toBeGreaterThan(0);
  const builds = eventsFor(events, "renderer.build", "end");
  const keys = new Set(builds.map((event) => String(event.detail?.rendererId ?? "")));
  expect(keys.size).toBeGreaterThan(0);
});

function pipelineStageEvents(events: E2ETraceEvent[], disposition: string, stage: string) {
  return eventsFor(events, `pipeline.stage.${disposition}`).filter((event) => event.detail?.stage === stage);
}

test("Gate C: renderer switch gates substrate by capability", async ({ page }) => {
  await loadApp(page, "Edge Current");
  await beginScenario(page, "gate-c-renderer-switch");
  await page.getByRole("button", { name: "Ripple lines" }).click();
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
  let events = await readTrace(page);
  expect(eventsFor(events, "substrate.request", "start").length).toBe(0);
  expect(pipelineStageEvents(events, "skipped", "substrate").length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "SDF Halftone" }).click();
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
  events = await readTrace(page);
  expect(
    eventsFor(events, "pipeline.requirements.resolve").some(
      (event) => event.detail?.rendererId === "sdf-halftone" && event.detail?.substrate === true,
    ),
  ).toBe(true);
  expect(eventsFor(events, "substrate.request", "start").length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Flow lines" }).click();
  await expect(page.locator("button.export")).toBeEnabled({ timeout: 30_000 });
  events = await readTrace(page);
  expect(
    pipelineStageEvents(events, "skipped", "substrate").some(
      (event) => event.detail?.reason === "capability-not-required",
    ),
  ).toBe(true);
});

test("Gate E: preview backend switch schedules zero authoritative builds", async ({ page }) => {
  await loadApp(page, "Edge Current");
  await beginScenario(page, "gate-e-backend");
  await page.getByRole("button", { name: "05 Preview" }).click();
  const backend = page.locator("label.field.compact-field").filter({ hasText: "Preview Mode" }).locator("select");
  await backend.selectOption("svg-dom");
  await backend.selectOption("canvas-2d");
  const events = await readTrace(page);
  expect(eventsFor(events, "typography.build", "end").length).toBe(0);
  expect(eventsFor(events, "scene.layout").length).toBe(0);
  expect(eventsFor(events, "substrate.request", "start").length).toBe(0);
  expect(authoritativeEventsFor(events, "renderer.build", "end").length).toBe(0);
});

test("Gate D: diagnostics toggle schedules zero authoritative builds", async ({ page }) => {
  await loadApp(page, "Edge Current");
  await beginScenario(page, "gate-d-diagnostics");
  await page.getByRole("button", { name: "07 Diagnostics" }).click();
  const diagnostics = page.locator("label.field.compact-field").filter({ hasText: "Diagnostics visibility" }).locator("select");
  await diagnostics.selectOption("full");
  await diagnostics.selectOption("compact");
  await diagnostics.selectOption("off");
  const events = await readTrace(page);
  expect(eventsFor(events, "typography.build", "end").length).toBe(0);
  expect(eventsFor(events, "scene.layout").length).toBe(0);
  expect(eventsFor(events, "substrate.request", "start").length).toBe(0);
  expect(authoritativeEventsFor(events, "renderer.build", "end").length).toBe(0);
});

test("Gate F: navigation schedules zero authoritative builds", async ({ page }) => {
  await loadApp(page, "Edge Current");
  const sceneKey = await page.getByTestId("viewport-stage").getAttribute("data-scene-layout-key");
  await beginScenario(page, "gate-f-navigation");
  await navigateViewport(page);
  const events = await readTrace(page);
  expect(eventsFor(events, "project.patch").length).toBe(0);
  expect(eventsFor(events, "typography.build", "end").length).toBe(0);
  expect(eventsFor(events, "scene.layout").length).toBe(0);
  expect(eventsFor(events, "substrate.request", "start").length).toBe(0);
  expect(authoritativeEventsFor(events, "renderer.build", "end").length).toBe(0);
  expect(await page.getByTestId("viewport-stage").getAttribute("data-scene-layout-key")).toBe(sceneKey);
});