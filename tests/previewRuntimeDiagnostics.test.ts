import { describe, expect, it } from "vitest";
import {
  beginPreviewRuntimeCapture,
  endPreviewRuntimeCapture,
  recordPreviewAppRender,
  recordPreviewClockCommit,
  recordPreviewGeometryBuild,
  recordPreviewPathCommit,
} from "../src/engine/previewRuntimeDiagnostics";

describe("preview runtime diagnostics", () => {
  it("collects one deterministic live-pipeline sample without logging or React state", () => {
    beginPreviewRuntimeCapture();
    recordPreviewAppRender();
    recordPreviewClockCommit(33.3, 0.08);
    recordPreviewGeometryBuild(0.45);
    recordPreviewPathCommit({
      pathGroupingMs: 2.5,
      domWriteMs: 0.9,
      stats: { dUpdates: 10, opacityUpdates: 0, attributeWrites: 10, nodeIdentityReused: true },
      segmentCount: 1564,
      activeBuckets: 10,
      dStringLength: 37_708,
    });

    const capture = endPreviewRuntimeCapture();
    expect(capture.appRenderCount).toBe(1);
    expect(capture.geometryBuildCount).toBe(1);
    expect(capture.frames).toHaveLength(1);
    expect(capture.frames[0]).toMatchObject({
      clockElapsedMs: 33.3,
      jsUpdateMs: 0.08,
      geometryBuildMs: 0.45,
      pathGroupingMs: 2.5,
      domWriteMs: 0.9,
      attributeWrites: 10,
      changedBuckets: 10,
      segmentCount: 1564,
      activeBuckets: 10,
      dStringLength: 37_708,
    });
  });

  it("stops collecting after capture ends", () => {
    beginPreviewRuntimeCapture();
    endPreviewRuntimeCapture();
    recordPreviewAppRender();
    recordPreviewGeometryBuild(1);
    expect(endPreviewRuntimeCapture()).toMatchObject({
      frames: [],
      appRenderCount: 0,
      geometryBuildCount: 0,
    });
  });
});
