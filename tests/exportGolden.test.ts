import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeSvgForGolden, type SvgExportSummary } from "./utils/canonicalSvg";
import { generateGoldenExport, goldenProjectNames } from "./utils/goldenExport";

const updateFixtures = process.env.UPDATE_EXPORT_FIXTURES === "1";

describe("Final Artwork SVG golden corpus", () => {
  for (const name of goldenProjectNames) {
    it(`${name} matches its canonical export summary`, async () => {
      const { project, svg, summary } = await generateGoldenExport(name);
      const summaryPath = resolve(`tests/fixtures/export-summaries/${name}.json`);

      expect(project.font).toBeNull();
      expect(project.exportMode).toBe("artwork");
      expect(summary.viewBox).toBe("0 0 1200 720");
      expect(summary.elementCounts.image).toBe(0);
      expect(summary.elementCounts.canvas).toBe(0);
      expect(summary.elementCounts.foreignObject).toBe(0);
      expect(summary.hasDataImage).toBe(false);
      expect(summary.hasBase64).toBe(false);
      expect(canonicalizeSvgForGolden(svg)).toContain("<svg");

      if (updateFixtures) {
        const previous = existsSync(summaryPath)
          ? JSON.parse(readFileSync(summaryPath, "utf8")) as SvgExportSummary
          : null;
        writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
        console.log(
          `[export-fixture] ${name}: ${previous?.canonicalHash ?? "(new)"} -> ${summary.canonicalHash}`,
          summary.elementCounts,
        );
      } else {
        const expected = JSON.parse(readFileSync(summaryPath, "utf8")) as SvgExportSummary;
        expect(summary).toEqual(expected);
      }
    });
  }
});
