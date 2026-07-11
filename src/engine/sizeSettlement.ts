import type { RendererId } from "../types";

/**
 * One immutable settlement target for a completed Size gesture. It is derived
 * once from the committed document and the authoritative input keys that the
 * exact renderer/substrate pipeline must catch up to. The target never embeds
 * a moving output key (e.g. the in-flight substrate output), so the captured
 * identity cannot drift while asynchronous geometry is pending.
 */
export interface SizeSettlementTarget {
  readonly settlementToken: number;
  readonly rendererId: RendererId;
  readonly requiresSubstrate: boolean;
  readonly draftSize: number;
  readonly documentKey: string;
  readonly typographyInputKey: string;
  readonly expectedTypographyOutputKey: string;
  /** Settled substrate input identity; `null` when the renderer needs no substrate. */
  readonly substrateInputKey: string | null;
  /** Renderer input identity assuming the settled substrate input. */
  readonly rendererInputKey: string;
}

export interface SizeSettlementReadinessInput {
  readonly target: SizeSettlementTarget;
  readonly currentDocumentKey: string;
  readonly currentTypographyOutputKey: string | null;
  readonly currentSubstrateOutputKey: string | null;
  /** Current renderer input identity (built from the live substrate output). */
  readonly currentRendererInputKey: string;
}

export interface SizeSettlementReadiness {
  readonly ready: boolean;
  readonly blockedReason: SizeSettlementBlockedReason | null;
}

export type SizeSettlementBlockedReason =
  | "document-changed"
  | "typography-pending"
  | "substrate-pending"
  | "renderer-pending";

/**
 * Pure readiness resolver. Ready only when the authoritative pipeline's current
 * output keys match the immutable target's input keys. Non-substrate renderers
 * never wait for substrate. Draft-preview readiness does not participate here.
 */
export function resolveSizeSettlementReadiness(
  input: SizeSettlementReadinessInput,
): SizeSettlementReadiness {
  if (input.currentDocumentKey !== input.target.documentKey) {
    return { ready: false, blockedReason: "document-changed" };
  }
  if (input.currentTypographyOutputKey !== input.target.expectedTypographyOutputKey) {
    return { ready: false, blockedReason: "typography-pending" };
  }
  if (input.target.requiresSubstrate) {
    if (input.currentSubstrateOutputKey !== input.target.substrateInputKey) {
      return { ready: false, blockedReason: "substrate-pending" };
    }
  }
  if (input.currentRendererInputKey !== input.target.rendererInputKey) {
    return { ready: false, blockedReason: "renderer-pending" };
  }
  return { ready: true, blockedReason: null };
}