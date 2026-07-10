import { describe, expect, it } from "vitest";
import {
  captureExportSnapshot,
  documentKey,
  rendererInputKey,
  resolveExportReadiness,
  resolveFontResolution,
  typographyInputKey,
  typographyOutputKey,
} from "../src/engine/exportAuthority";
import { createTimedSvgFromSnapshot } from "../src/engine/exportSvg";
import { baseState } from "../src/engine/presets";
import type { SubstrateData } from "../src/engine/substrate";

const nativeFont = resolveFontResolution(baseState, null);
const typographyInput = typographyInputKey(baseState, nativeFont.resourceKey!);
const typographyOutput = typographyOutputKey(typographyInput, nativeFont, null)!;
const substrate = {} as SubstrateData;

function readiness(overrides: Partial<Parameters<typeof resolveExportReadiness>[0]> = {}) {
  const state = { ...baseState, renderer: "sdf-flow" as const };
  const rendererKey = rendererInputKey(state, typographyOutput, "substrate:B", { timeMs: 0, frame: 0 });
  return resolveExportReadiness({
    font: nativeFont,
    typographyInputKey: typographyInput,
    typographyOutputKey: typographyOutput,
    substrateInputKey: "substrate:B",
    substrateOutputKey: "substrate:B",
    substrateData: substrate,
    rendererInputKey: rendererKey,
    rendererGeometryKey: rendererKey,
    autoGrowPending: false,
    renderer: state.renderer,
    ...overrides,
  });
}

describe("authoritative export readiness", () => {
  it("does not block a non-substrate renderer on an unrelated substrate build", () => {
    const state = { ...baseState, renderer: "dots" as const };
    const rendererKey = rendererInputKey(state, typographyOutput, null, { timeMs: 0, frame: 0 });
    expect(readiness({
      renderer: "dots",
      substrateOutputKey: null,
      substrateData: null,
      rendererInputKey: rendererKey,
      rendererGeometryKey: rendererKey,
    }).status).toBe("ready");
  });

  it("keeps stale preview substrate from becoming export-current", () => {
    expect(readiness({ substrateOutputKey: "substrate:A" })).toMatchObject({
      status: "revision-mismatch",
      expectedKey: "substrate:B",
      actualKey: "substrate:A",
    });
  });

  it("only accepts the newest matching substrate result after repeated changes", () => {
    expect(readiness({ substrateInputKey: "substrate:C", substrateOutputKey: "substrate:B" }).status)
      .toBe("revision-mismatch");
    expect(readiness({ substrateInputKey: "substrate:C", substrateOutputKey: "substrate:C" }).status)
      .toBe("ready");
  });

  it("keeps diagnostics out of document and renderer identities", () => {
    const debugged = { ...baseState, debug: { ...baseState.debug, glyphBounds: !baseState.debug.glyphBounds } };
    expect(documentKey(debugged)).toBe(documentKey(baseState));
    expect(rendererInputKey(debugged, typographyOutput, null, { timeMs: 0, frame: 0 }))
      .toBe(rendererInputKey(baseState, typographyOutput, null, { timeMs: 0, frame: 0 }));
  });

  it("captures one CPU-owned current-frame context for geometry and SVG metadata", () => {
    const state = { ...baseState, renderer: "flow" as const, exportFrameMode: "current" as const, maxNodes: 8 };
    const font = resolveFontResolution(state, null);
    const input = typographyInputKey(state, font.resourceKey!);
    const output = typographyOutputKey(input, font, null)!;
    const snapshot = captureExportSnapshot({
      state,
      documentKey: documentKey(state),
      font,
      typographyInputKey: input,
      typographyOutputKey: output,
      typographyGeometry: null,
      substrateInputKey: "unused",
      substrateOutputKey: null,
      substrateData: null,
      context: { mode: "current", timeMs: 1234, frame: 37 },
      appVersion: "test",
    });
    const svg = createTimedSvgFromSnapshot(snapshot).svg;
    const metadata = JSON.parse(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("metadata")!.textContent!);
    expect(snapshot.context).toEqual({ mode: "current", timeMs: 1234, frame: 37 });
    expect(metadata.exportContext).toEqual({ mode: "current", timeMs: 1234, frame: 37 });
  });

  it("does not allow an unresolved exact font to fall back silently", () => {
    const state = { ...baseState, font: { family: "Missing", fullName: "Missing", fileName: "missing.ttf", unitsPerEm: 1000, ascender: 800, descender: -200 } };
    const font = resolveFontResolution(state, null);
    expect(font.status).toBe("missing");
    expect(readiness({ font }).status).toBe("font-missing");
  });

  it("blocks a pending auto-grow expansion", () => {
    expect(readiness({ autoGrowPending: true }).status).toBe("auto-grow-pending");
  });
});
