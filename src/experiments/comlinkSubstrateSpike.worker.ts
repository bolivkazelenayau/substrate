import { expose, transfer } from "comlink";
import { buildSubstrate } from "../engine/substrate/buildSubstrate";
import type { SubstrateBuildInput, SubstrateBuildResult } from "../engine/substrate/types";

export interface ComlinkSubstrateSpikeApi {
  build(input: SubstrateBuildInput): Promise<SubstrateBuildResult>;
}

const api: ComlinkSubstrateSpikeApi = {
  async build(input) {
    const result = buildSubstrate(input);
    return transfer(result, [
      result.data.mask.data.buffer,
      result.data.edge.data.buffer,
      result.data.distance.data.buffer,
    ]);
  },
};

expose(api);
