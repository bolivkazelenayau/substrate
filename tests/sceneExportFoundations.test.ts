import { describe, expect, it } from "vitest";
import {
  captureExportSnapshot,
  documentKey,
  resolveExportReadiness,
  resolveFontResolution,
  typographyInputKey,
  typographyOutputKey,
} from "../src/engine/exportAuthority";
import { createTimedSvgFromSnapshot } from "../src/engine/exportSvg";
import { baseState } from "../src/engine/presets";
import { buildProductionSceneFrame } from "./utils/sceneLayoutHarness";

describe("scene export foundations", () => {
  it("records authored and effective artboard plus scene keys in export snapshots", () => {
    const state = { ...baseState, renderer: "flow" as const, fontSize: 300 };
    const frame = buildProductionSceneFrame(state, null);
    const font = resolveFontResolution(state, null);
    const typographyInput = typographyInputKey(state, font.resourceKey!);
    const typographyOutput = typographyOutputKey(typographyInput, font, null)!;
    const snapshot = captureExportSnapshot({
      state,
      documentKey: documentKey(state),
      font,
      typographyInputKey: typographyInput,
      typographyOutputKey: typographyOutput,
      typographyGeometry: null,
      substrateInputKey: "unused",
      substrateOutputKey: null,
      substrateData: null,
      context: { mode: "current", timeMs: 0, frame: 0 },
      appVersion: "test",
      authoredArtboard: frame.scene.authoredArtboard,
      effectiveArtboard: frame.scene.effectiveArtboard,
      sceneLayoutKey: frame.scene.key,
      typographyPlacementKey: frame.scene.typography.key,
    });

    expect(snapshot.authoredArtboard).toEqual(frame.scene.authoredArtboard);
    expect(snapshot.effectiveArtboard).toEqual(frame.scene.effectiveArtboard);
    expect(snapshot.sceneLayoutKey).toBe(frame.scene.key);
    expect(snapshot.typographyPlacementKey).toBe(frame.scene.typography.key);
  });

  it("serializes the effective rect into the SVG viewBox", () => {
    const state = { ...baseState, renderer: "flow" as const, fontSize: 540 };
    const frame = buildProductionSceneFrame(state, null);
    const font = resolveFontResolution(state, null);
    const typographyInput = typographyInputKey(state, font.resourceKey!);
    const typographyOutput = typographyOutputKey(typographyInput, font, null)!;
    const snapshot = captureExportSnapshot({
      state,
      documentKey: documentKey(state),
      font,
      typographyInputKey: typographyInput,
      typographyOutputKey: typographyOutput,
      typographyGeometry: null,
      substrateInputKey: "unused",
      substrateOutputKey: null,
      substrateData: null,
      context: { mode: "time-zero", timeMs: 0, frame: 0 },
      appVersion: "test",
      authoredArtboard: frame.scene.authoredArtboard,
      effectiveArtboard: frame.scene.effectiveArtboard,
      sceneLayoutKey: frame.scene.key,
      typographyPlacementKey: frame.scene.typography.key,
    });
    const svg = createTimedSvgFromSnapshot(snapshot).svg;
    const metadata = JSON.parse(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("metadata")!.textContent!);
    const viewBox = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement.getAttribute("viewBox");
    const rect = frame.scene.effectiveArtboard;
    expect(viewBox).toBe(`${rect.x} ${rect.y} ${rect.width} ${rect.height}`);
    expect(metadata.authoredArtboard).toEqual(frame.scene.authoredArtboard);
    expect(metadata.effectiveArtboard).toEqual(frame.scene.effectiveArtboard);
  });

  it("does not block export readiness on removed auto-grow commits", () => {
    const state = { ...baseState, renderer: "dots" as const };
    const font = resolveFontResolution(state, null);
    const typographyInput = typographyInputKey(state, font.resourceKey!);
    const typographyOutput = typographyOutputKey(typographyInput, font, null)!;
    const readiness = resolveExportReadiness({
      font,
      typographyInputKey: typographyInput,
      typographyOutputKey: typographyOutput,
      substrateInputKey: "unused",
      substrateOutputKey: null,
      substrateData: null,
      rendererInputKey: "renderer:test",
      rendererGeometryKey: "renderer:test",
      sceneSafetyLimitHit: false,
      renderer: "dots",
    });
    expect(readiness.status).toBe("ready");
  });
});