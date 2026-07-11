import { describe, expect, it } from "vitest";
import { resolveSizeSettlementReadiness, type SizeSettlementTarget } from "../src/engine/sizeSettlement";

const target = (overrides: Partial<SizeSettlementTarget> = {}): SizeSettlementTarget => ({
  settlementToken: 1,
  rendererId: "ripple",
  requiresSubstrate: false,
  draftSize: 235,
  documentKey: "document:1",
  typographyInputKey: "typography-input:1",
  expectedTypographyOutputKey: "typography-output:1",
  substrateInputKey: null,
  rendererInputKey: "renderer-input:1",
  ...overrides,
});

describe("resolveSizeSettlementReadiness", () => {
  it("is ready when all outputs match the committed input targets", () => {
    const t = target();
    const r = resolveSizeSettlementReadiness({
      target: t,
      currentDocumentKey: t.documentKey,
      currentTypographyOutputKey: t.expectedTypographyOutputKey,
      currentSubstrateOutputKey: null,
      currentRendererInputKey: t.rendererInputKey,
    });
    expect(r.ready).toBe(true);
    expect(r.blockedReason).toBeNull();
  });

  it("blocks on document-changed when the document key drifted", () => {
    const r = resolveSizeSettlementReadiness({
      target: target({ documentKey: "document:1" }),
      currentDocumentKey: "document:2",
      currentTypographyOutputKey: "typography-output:1",
      currentSubstrateOutputKey: null,
      currentRendererInputKey: "renderer-input:1",
    });
    expect(r.ready).toBe(false);
    expect(r.blockedReason).toBe("document-changed");
  });

  it("blocks on typography-pending when the output key is null", () => {
    const r = resolveSizeSettlementReadiness({
      target: target(),
      currentDocumentKey: "document:1",
      currentTypographyOutputKey: null,
      currentSubstrateOutputKey: null,
      currentRendererInputKey: "renderer-input:1",
    });
    expect(r.ready).toBe(false);
    expect(r.blockedReason).toBe("typography-pending");
  });

  it("waits for substrate only when the renderer requires substrate", () => {
    const t = target({ rendererId: "sdf-halftone", requiresSubstrate: true, substrateInputKey: "substrate-input:1" });
    const stale = resolveSizeSettlementReadiness({
      target: t,
      currentDocumentKey: t.documentKey,
      currentTypographyOutputKey: t.expectedTypographyOutputKey,
      // Live worker result still carries the previous signature.
      currentSubstrateOutputKey: "substrate-output:stale",
      currentRendererInputKey: t.rendererInputKey,
    });
    expect(stale.ready).toBe(false);
    expect(stale.blockedReason).toBe("substrate-pending");

    const ready = resolveSizeSettlementReadiness({
      target: t,
      currentDocumentKey: t.documentKey,
      currentTypographyOutputKey: t.expectedTypographyOutputKey,
      currentSubstrateOutputKey: t.substrateInputKey,
      currentRendererInputKey: t.rendererInputKey,
    });
    expect(ready.ready).toBe(true);
  });

  it("does not wait for substrate when the renderer is non-substrate", () => {
    const t = target({ rendererId: "ripple", requiresSubstrate: false, substrateInputKey: null });
    const r = resolveSizeSettlementReadiness({
      target: t,
      currentDocumentKey: t.documentKey,
      currentTypographyOutputKey: t.expectedTypographyOutputKey,
      // Live substrate output is irrelevant and may be anything.
      currentSubstrateOutputKey: "substrate-output:foreign",
      currentRendererInputKey: t.rendererInputKey,
    });
    expect(r.ready).toBe(true);
  });

  it("blocks on renderer-pending when the live input differs from the settled target", () => {
    const t = target();
    const r = resolveSizeSettlementReadiness({
      target: t,
      currentDocumentKey: t.documentKey,
      currentTypographyOutputKey: t.expectedTypographyOutputKey,
      currentSubstrateOutputKey: null,
      currentRendererInputKey: "renderer-input:stale",
    });
    expect(r.ready).toBe(false);
    expect(r.blockedReason).toBe("renderer-pending");
  });

  it("ignores all draft-preview keys (draft readiness does not gate completion)", () => {
    const t = target();
    const r = resolveSizeSettlementReadiness({
      target: t,
      currentDocumentKey: t.documentKey,
      currentTypographyOutputKey: t.expectedTypographyOutputKey,
      currentSubstrateOutputKey: null,
      currentRendererInputKey: t.rendererInputKey,
    });
    // Draft-preview keys are not part of the resolver input at all.
    expect(r.ready).toBe(true);
    expect("draftPreviewKey" in r).toBe(false);
  });
});