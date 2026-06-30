import { describe, expect, it, vi } from "vitest";
import { validateGraphDocument } from "../src/graph/graphValidation";
import { adaptVectorRenderer } from "../src/graph/rendererNodeAdapter";
import type { VectorRenderer } from "../src/engine/renderers/types";

describe("future Graph IR", () => {
  it("validates a minimal connected graph without touching ProjectState", () => {
    const graph = validateGraphDocument({
      version: 1,
      nodes: [
        { id: "field", type: "field.scalar", version: 1, parameters: {} },
        { id: "renderer", type: "renderer.flow", version: 1, parameters: {} },
      ],
      connections: [{
        id: "field-to-renderer",
        from: { nodeId: "field", socketId: "field" },
        to: { nodeId: "renderer", socketId: "field" },
      }],
      outputs: [{ nodeId: "renderer", socketId: "geometry", kind: "geometry" }],
    });
    expect(graph.outputs[0].kind).toBe("geometry");
  });

  it("rejects duplicate ids and dangling node references", () => {
    expect(() => validateGraphDocument({
      version: 1,
      nodes: [{ id: "same", type: "a", version: 1, parameters: {} }, { id: "same", type: "b", version: 1, parameters: {} }],
      connections: [],
      outputs: [],
    })).toThrow(/duplicate node ids/);
    expect(() => validateGraphDocument({
      version: 1,
      nodes: [],
      connections: [],
      outputs: [{ nodeId: "missing", socketId: "geometry", kind: "geometry" }],
    })).toThrow(/unknown node/);
  });

  it("adapts a VectorRenderer as a geometry-producing node without changing it", () => {
    const geometry = { id: "flow", geometries: [] };
    const generateGeometry = vi.fn(() => geometry);
    const renderer = {
      id: "flow",
      label: "Flow",
      supportedControls: [],
      svgElementType: "line",
      usesTime: true,
      usesSubstrate: false,
      generateGeometry,
      estimateCost: () => ({ marks: 0, nodes: 0, label: "0" }),
    } satisfies VectorRenderer;
    const adapter = adaptVectorRenderer(renderer);

    expect(adapter.renderer).toBe(renderer);
    expect(adapter.definition.outputs).toEqual([{ id: "geometry", label: "Geometry", kind: "geometry" }]);
    expect(adapter.evaluate({} as never, {} as never)).toBe(geometry);
    expect(generateGeometry).toHaveBeenCalledOnce();
  });
});
