import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateGraphDocument } from "../src/graph/graphValidation";
import { createRendererNodeDefinition } from "../src/graph/rendererNodeAdapter";
import type { GraphDocument } from "../src/graph/graphTypes";
import type { VectorRenderer } from "../src/engine/renderers/types";

function graph(overrides: Partial<GraphDocument> = {}): GraphDocument {
  return {
    version: 1,
    nodes: [
      { id: "field", type: "field.scalar", params: {} },
      { id: "renderer", type: "renderer.flow", params: {}, position: { x: 80, y: 40 } },
    ],
    connections: [{
      id: "field-to-renderer",
      fromNodeId: "field",
      fromSocketId: "field",
      toNodeId: "renderer",
      toSocketId: "field",
    }],
    outputNodeId: "renderer",
    ...overrides,
  };
}

describe("future Graph IR", () => {
  it("accepts a minimal connected graph", () => {
    expect(validateGraphDocument(graph())).toEqual([]);
  });

  it("reports duplicate node ids deterministically", () => {
    const issues = validateGraphDocument(graph({
      nodes: [
        { id: "same", type: "input", params: {} },
        { id: "same", type: "output", params: {} },
      ],
      outputNodeId: "same",
    }));
    expect(issues).toContainEqual({
      code: "duplicate-node-id",
      message: 'Graph node id "same" is duplicated.',
    });
  });

  it("reports a missing output node", () => {
    expect(validateGraphDocument(graph({ outputNodeId: "missing" }))).toContainEqual({
      code: "missing-output-node",
      message: 'Graph output node "missing" does not exist.',
    });
  });

  it("reports missing connection endpoints and self-connections", () => {
    const issues = validateGraphDocument(graph({
      connections: [
        {
          id: "missing-source",
          fromNodeId: "missing",
          fromSocketId: "out",
          toNodeId: "renderer",
          toSocketId: "in",
        },
        {
          id: "missing-target",
          fromNodeId: "field",
          fromSocketId: "out",
          toNodeId: "missing",
          toSocketId: "in",
        },
        {
          id: "self",
          fromNodeId: "field",
          fromSocketId: "out",
          toNodeId: "field",
          toSocketId: "in",
        },
      ],
    }));
    expect(issues.map(({ code }) => code)).toEqual([
      "missing-source-node",
      "missing-target-node",
      "self-connection",
    ]);
  });

  it("describes a current renderer as a geometry-producing renderer node", () => {
    const renderer = {
      id: "flow",
      label: "Flow",
      supportedControls: [],
      svgElementType: "line",
      usesTime: true,
      usesSubstrate: false,
      generateGeometry: () => ({ id: "flow", geometries: [] }),
      estimateCost: () => ({ marks: 0, nodes: 0, label: "0" }),
    } satisfies VectorRenderer;
    const definition = createRendererNodeDefinition(renderer);

    expect(definition.category).toBe("renderer");
    expect(definition.type).toBe("renderer.flow");
    expect(definition.inputs).toContainEqual({
      id: "time",
      label: "Time",
      kind: "number",
      direction: "input",
      defaultValue: 0,
    });
    expect(definition.outputs).toEqual([{
      id: "geometry",
      label: "Geometry",
      kind: "geometry",
      direction: "output",
    }]);
  });
});

describe("Graph IR boundaries", () => {
  it("does not import React, WebGPU, Canvas preview, or SVG export", () => {
    const directory = resolve(process.cwd(), "src/graph");
    const files = readdirSync(directory)
      .map((name) => resolve(directory, name))
      .filter((file) => statSync(file).isFile() && /\.tsx?$/.test(file));
    const forbidden = /\breact\b|webgpu|canvas(?:flow)?preview|exportsvg/i;
    const violations = files.flatMap((file) => {
      const imports = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => /^\s*import\b/.test(line) && forbidden.test(line));
      return imports.map((line) => `${relative(directory, file)}: ${line.trim()}`);
    });

    expect(violations).toEqual([]);
  });
});
