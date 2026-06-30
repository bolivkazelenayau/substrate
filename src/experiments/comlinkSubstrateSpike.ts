import { releaseProxy, wrap } from "comlink";
import type { Remote } from "comlink";
import type { SubstrateBuildInput, SubstrateBuildResult } from "../engine/substrate/types";
import type { ComlinkSubstrateSpikeApi } from "./comlinkSubstrateSpike.worker";

/**
 * Isolated protocol spike. It is intentionally not imported by production code.
 * LatestOnlyScheduler, CPU fallback, capability reporting, and stale-result
 * protection remain owned by the existing backend if this adapter is evaluated.
 */
export class ComlinkSubstrateSpike {
  readonly worker: Worker;
  readonly remote: Remote<ComlinkSubstrateSpikeApi>;

  constructor() {
    this.worker = new Worker(new URL("./comlinkSubstrateSpike.worker.ts", import.meta.url), { type: "module" });
    this.remote = wrap<ComlinkSubstrateSpikeApi>(this.worker);
  }

  build(input: SubstrateBuildInput): Promise<SubstrateBuildResult> {
    return this.remote.build(input);
  }

  dispose(): void {
    this.remote[releaseProxy]();
    this.worker.terminate();
  }
}
