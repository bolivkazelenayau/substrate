import type { ProductFeatureState } from "../../engine/parameterOwnership";

export function productStateLabel(featureState: ProductFeatureState): string | undefined {
  if (featureState.state === "legacy") return "LEGACY ACTIVE";
  if (featureState.state === "custom") return "CUSTOM";
  if (featureState.state === "tuned") return "TUNED";
  return undefined;
}

export function featureSummary(label: string, featureState: ProductFeatureState) {
  const status = productStateLabel(featureState);
  return status ? `${label} · ${status}` : label;
}
