import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { summarizeGeometry } from "../src/engine/rendererRuntime";
import { executeGraphCpu, type GeometryIR } from "../src/graph/graphExecution";
import { buildRendererGraphFromProject } from "../src/graph/rendererGraphBuilder";
import type { GraphDocument } from "../src/graph/graphTypes";
import { extractSvgExportSummary, type SvgExportSummary } from "./utils/canonicalSvg";
import { buildGoldenRenderInput, goldenProjectNames } from "./utils/goldenExport";

function canonicalGeometrySummary(geometry: GeometryIR) {
  return {
    ...summarizeGeometry(geometry),
    geometryHash: createHash("sha256")
      .update(JSON.stringify({ id: geometry.id, geometries: geometry.geometries }))
      .digest("hex"),
  };
}

describe("internal CPU graph execution prototype", () => {
  for (const name of goldenProjectNames) {
    it(`${name} matches registry geometry and golden export`, async () => {
      const { project, context, geometry: registryGeometry } = await buildGoldenRenderInput(name);
      const graph = buildRendererGraphFromProject(project);
      const result = executeGraphCpu(graph, { project, context });

      expect(graph.nodes).toHaveLength(1);
      expect(graph.connections).toEqual([]);
      expect(graph.nodes[0]?.type).toBe(`renderer.${project.renderer}`);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.issues.map(({ message }) => message).join(" "));

      expect(canonicalGeometrySummary(result.geometry))
        .toEqual(canonicalGeometrySummary(registryGeometry));

      const registrySvg = createSvg(project, context, null, registryGeometry);
      const graphSvg = createSvg(project, context, null, result.geometry);
      const expected = JSON.parse(readFileSync(
        resolve(`tests/fixtures/export-summaries/${name}.json`),
        "utf8",
      )) as SvgExportSummary;
      expect(extractSvgExportSummary(registrySvg).canonicalHash).toBe(expected.canonicalHash);
      expect(extractSvgExportSummary(graphSvg).canonicalHash).toBe(expected.canonicalHash);
    });
  }

  it("returns typed validation issues without executing an invalid graph", async () => {
    const { project, context } = await buildGoldenRenderInput(goldenProjectNames[0]);
    const graph: GraphDocument = {
      version: 1,
      nodes: [],
      connections: [],
      outputNodeId: "missing",
    };
    const result = executeGraphCpu(graph, { project, context });

    expect(result).toMatchObject({
      backend: "cpu",
      ok: false,
      outputNodeId: "missing",
      geometry: null,
      issues: [{
        code: "graph-validation",
        validationIssue: { code: "missing-output-node" },
      }],
    });
  });

  it("rejects a renderer node that disagrees with the input project", async () => {
    const { project, context } = await buildGoldenRenderInput(goldenProjectNames[0]);
    const graph = buildRendererGraphFromProject({ ...project, renderer: "dots" });
    const result = executeGraphCpu(graph, { project, context });

    expect(result).toMatchObject({
      backend: "cpu",
      ok: false,
      geometry: null,
      issues: [{
        code: "renderer-project-mismatch",
        graphRendererId: "dots",
        projectRendererId: project.renderer,
      }],
    });
  });
});
