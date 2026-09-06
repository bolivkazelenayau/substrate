import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const legacyV8 = resolve("tests/fixtures/projects/legacy/v8.substrate.json");
const stage = (page: Page) => page.getByTestId("viewport-stage");
const projectInput = (page: Page) => page.locator('input[type="file"][accept*="application/json"]');

async function openExportPanel(page: Page) {
  const button = page.locator("button.panel-heading-button").filter({ hasText: "Export" });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

async function waitForExactPreview(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", "ready", { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute("data-text-geometry-key", /.+/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled({ timeout: 60_000 });
}

async function saveProject(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Project download path was unavailable.");
  return {
    path,
    document: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>,
  };
}

test.describe("legacy project compatibility browser gates", () => {
  test("imports v8, renders, exports, saves as v15, and reloads normalized state", async ({ page }) => {
    await page.goto("/");
    await openExportPanel(page);
    await projectInput(page).setInputFiles(legacyV8);

    await expect(page.getByLabel("Text substrate")).toHaveValue("LEGACY EIGHT");
    await expect(page.locator('[aria-label="Renderer"] button.active')).toContainText("Glyph Diffuser");
    await expect(stage(page)).toHaveAttribute("data-artboard-authored-width", "1480");
    await expect(stage(page)).toHaveAttribute("data-artboard-authored-height", "820");
    await expect(stage(page)).toHaveAttribute("data-glyph-displacement-key", "disabled");
    await expect(stage(page)).toHaveAttribute("data-glyph-displacement-mode", "disabled");
    await expect(stage(page)).toHaveAttribute("data-dot-grid-regular", "false");
    await expect(stage(page)).toHaveAttribute("data-emitter-display-mode", "field");
    await expect(page.getByTestId("project-message")).toContainText("migrated to schema version 15");
    await waitForExactPreview(page);

    const svgDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export SVG/ }).click();
    const svgDownload = await svgDownloadPromise;
    const svgPath = await svgDownload.path();
    if (!svgPath) throw new Error("SVG download path was unavailable.");
    const svg = readFileSync(svgPath, "utf8");
    expect(svg).toMatch(/^<svg\b/);
    expect(svg).toMatch(/<(?:text|circle|path|line|polyline)\b/);
    expect(svg).not.toMatch(/<(?:image|canvas|foreignObject)\b|data:image|;base64,/i);

    const firstSave = await saveProject(page);
    expect(firstSave.document).toMatchObject({
      version: 15,
      text: "LEGACY EIGHT",
      renderer: "glyph-diffuser",
      seed: 80808,
      artboard: { width: 1480, height: 820 },
      emitterDisplay: { mode: "field" },
      glyphDisplacement: { enabled: false },
      dotGrid: { enabled: false },
      displayDislocation: { enabled: false },
      glyphFalloffDisplacement: { mode: "off" },
      emitterMicroResponse: { enabled: false, occupancy: "legacy" },
      glyphMicroWarp: { enabled: false },
    });

    await openExportPanel(page);
    await projectInput(page).setInputFiles(firstSave.path);
    await waitForExactPreview(page);
    const secondSave = await saveProject(page);
    expect(secondSave.document).toEqual(firstSave.document);
  });

  test("shows distinct actionable errors and preserves the open project", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Text substrate").fill("KEEP CURRENT PROJECT");
    await openExportPanel(page);

    await projectInput(page).setInputFiles({
      name: "invalid-syntax.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version": 8,'),
    });
    await expect(page.getByTestId("project-message")).toContainText("Invalid JSON syntax");
    await expect(page.getByLabel("Text substrate")).toHaveValue("KEEP CURRENT PROJECT");

    await projectInput(page).setInputFiles({
      name: "future.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 99, text: "FUTURE", renderer: "flow", seed: 1 })),
    });
    await expect(page.getByTestId("project-message")).toContainText("Unsupported schema version 99");
    await expect(page.getByLabel("Text substrate")).toHaveValue("KEEP CURRENT PROJECT");

    await projectInput(page).setInputFiles({
      name: "missing-current-field.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 12, artboard: { width: 1200, height: 720 }, renderer: "flow", seed: 1 })),
    });
    await expect(page.getByTestId("project-message")).toContainText('missing required current field "text"');
    await expect(page.getByLabel("Text substrate")).toHaveValue("KEEP CURRENT PROJECT");

    await projectInput(page).setInputFiles({
      name: "migration-failure.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 7, text: "BAD", renderer: "removed-renderer", seed: 1 })),
    });
    await expect(page.getByTestId("project-message")).toContainText("Project migration failed for schema v7");
    await expect(page.getByTestId("project-message")).toContainText("Unknown renderer");
    await expect(page.getByLabel("Text substrate")).toHaveValue("KEEP CURRENT PROJECT");
  });
});
