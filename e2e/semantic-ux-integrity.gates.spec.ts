import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const parsedFontFixture = resolve("tests/fixtures/Basic-Regular.ttf");
const stage = (page: Page) => page.getByTestId("viewport-stage");

async function waitForReady(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-substrate-phase", /^(ready|not-required)$/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled({ timeout: 60_000 });
}

async function loadOutlineFont(page: Page) {
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(parsedFontFixture);
  await expect(page.getByTestId("project-message")).toContainText("loaded", { timeout: 60_000 });
  await waitForReady(page);
}

async function openMicroResponse(page: Page) {
  const summary = page.locator("button.accordion-summary").filter({ hasText: "Emitter Micro Response" });
  if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
}

async function openDisclosure(page: Page, name: string) {
  const summary = page.locator("button.accordion-summary").filter({ hasText: name });
  if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
}

test.describe("Semantic UX Integrity Pass", () => {
  test("A — occupancy exposes one authoritative mode across Legacy, Exclude, and Disperse", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Preset").selectOption("Sonic Diffuser");
    await waitForReady(page);
    await openMicroResponse(page);

    const occupancy = page.getByTestId("emitter-micro-occupancy");
    await expect(page.getByTestId("emitter-micro-occupancy-enabled")).toHaveCount(0);
    for (const mode of ["legacy", "exclude-interior", "disperse-exterior"]) {
      await occupancy.selectOption(mode);
      await expect(occupancy).toHaveValue(mode);
      await expect(stage(page)).toHaveAttribute("data-emitter-micro-occupancy-domain", mode === "legacy"
        ? "legacy-glyph-ink"
        : "sealed-glyph-silhouette");
    }
  });

  test("B — scoped preset application preserves authored state outside its recipe", async ({ page }) => {
    await page.goto("/");
    await loadOutlineFont(page);
    await page.getByLabel("Preset").selectOption("Calm Current");
    await waitForReady(page);
    await openDisclosure(page, "Calm Water");

    const calmStrength = page.getByTestId("glyph-calm-water-strength");
    await calmStrength.fill("19");
    await openMicroResponse(page);
    const microEnabled = page.getByTestId("emitter-micro-enabled");
    if (!(await microEnabled.isChecked())) await microEnabled.check();
    await page.getByTestId("emitter-micro-occupancy").selectOption("disperse-exterior");
    await expect(calmStrength).toHaveValue("19");

    await page.getByLabel("Preset").selectOption("Signal Dust");
    await waitForReady(page);
    await openMicroResponse(page);
    await expect(page.getByTestId("preset-contract")).toContainText("Scope: Renderer · Core field · Emitter");
    await expect(calmStrength).toHaveValue("19");
    await expect(page.getByTestId("emitter-micro-response")).toContainText("Retained settings: Micro Response on · Occupancy Disperse exterior.");
    await expect(page.getByTestId("emitter-micro-enabled")).toHaveCount(0);
    await expect(page.getByTestId("emitter-micro-occupancy")).toHaveCount(0);
  });

  test("C — Display Dislocation and Glyph Fragmentation are mutually exclusive active modes", async ({ page }) => {
    await page.goto("/");
    await loadOutlineFont(page);
    await page.getByLabel("Preset").selectOption("Fragment Matrix");
    await waitForReady(page);
    await openDisclosure(page, "Glyph Fragmentation");
    await openDisclosure(page, "Renderer-local controls");

    const fragmentation = page.getByTestId("glyph-displacement-enabled");
    const display = page.getByTestId("display-dislocation-enabled");
    await expect(fragmentation).toBeChecked();
    await expect(display).not.toBeChecked();
    await expect(stage(page)).not.toHaveAttribute("data-glyph-displacement-key", "disabled");

    await display.check();
    await expect(display).toBeChecked();
    await expect(fragmentation).not.toBeChecked();
    await expect(fragmentation).not.toBeDisabled();
    await expect(fragmentation).toHaveAttribute("data-project-enabled", "false");
    await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "true");
    await expect(stage(page)).toHaveAttribute("data-glyph-displacement-key", "disabled");

    await fragmentation.check();
    await expect(fragmentation).toBeChecked();
    await expect(display).not.toBeChecked();
    await expect(stage(page)).not.toHaveAttribute("data-glyph-displacement-key", "disabled");
  });

  test("D — renderer switches show retained but unsupported Display Dislocation as inactive", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Preset").selectOption("Display Dislocation");
    await waitForReady(page);
    await openDisclosure(page, "Renderer-local controls");

    const display = page.getByTestId("display-dislocation-enabled");
    await expect(display).toBeChecked();
    await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "true");

    await page.getByRole("button", { name: "SDF Contours", exact: true }).click();
    await waitForReady(page);
    await openDisclosure(page, "Renderer-local controls");
    await expect(stage(page)).toHaveAttribute("data-display-dislocation-active", "false");
    await expect(display).not.toBeChecked();
    await expect(display).toBeDisabled();
    await expect(display).toHaveAttribute("data-project-enabled", "true");
    await expect(page.getByTestId("display-dislocation-controls")).toContainText("Retained but inactive");
  });
});
