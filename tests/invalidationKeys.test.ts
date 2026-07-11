import { describe, expect, it } from "vitest";
import { documentKey, substrateBuildInputKey, typographyInputKey } from "../src/engine/exportAuthority";
import { baseState } from "../src/engine/presets";
import { rendererGeometryStateKey } from "../src/engine/rendererRuntime";
import { getRendererManifest } from "../src/engine/renderers/rendererManifest";

describe("semantic invalidation boundaries", () => {
  it("keeps typography, substrate, renderer, and document identities stable for diagnostics", () => {
    const debugged = {
      ...baseState,
      debug: {
        ...baseState.debug,
        glyphBounds: !baseState.debug.glyphBounds,
        baseline: !baseState.debug.baseline,
        markOrigins: !baseState.debug.markOrigins,
        emitter: !baseState.debug.emitter,
        costEstimate: !baseState.debug.costEstimate,
      },
    };
    const typography = typographyInputKey(baseState, "font:native");
    const debugTypography = typographyInputKey(debugged, "font:native");
    const input = {
      sourceText: baseState.text,
      textGeometry: null,
      fontSize: baseState.fontSize,
      tracking: baseState.tracking,
      fontFamily: "sans-serif",
      fontWeight: 400,
      baselineY: 360,
      textX: 600,
      resolution: { width: 256, height: 154 },
      bounds: null,
      viewport: { width: baseState.artboard.width, height: baseState.artboard.height },
    };
    expect(debugTypography).toBe(typography);
    expect(substrateBuildInputKey(input, typography)).toBe(substrateBuildInputKey(input, debugTypography));
    expect(rendererGeometryStateKey(debugged)).toBe(rendererGeometryStateKey(baseState));
    expect(documentKey(debugged)).toBe(documentKey(baseState));
  });

  it("keeps appearance out of geometry identity while retaining it in the document", () => {
    const recolored = {
      ...baseState,
      primaryColor: "#ff0066",
      backgroundColor: "#001122",
      transparentBackground: !baseState.transparentBackground,
    };
    expect(rendererGeometryStateKey(recolored)).toBe(rendererGeometryStateKey(baseState));
    expect(documentKey(recolored)).not.toBe(documentKey(baseState));
  });

  it("uses the renderer manifest as the sole substrate capability gate", () => {
    expect(getRendererManifest("dots").usesSubstrate).toBe(false);
    expect(getRendererManifest("flow").usesSubstrate).toBe(false);
    expect(getRendererManifest("sdf-flow").usesSubstrate).toBe(true);
    expect(getRendererManifest("glyph-diffuser").usesSubstrate).toBe(true);
  });
});
