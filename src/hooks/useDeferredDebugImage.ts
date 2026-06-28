import { useEffect, useState } from "react";
import {
  getDeferredSubstrateDebugImage,
  type DeferredDebugImage,
  type SubstrateData,
  type SubstrateDebugMode,
} from "../engine/substrate";

export interface DebugImageState extends DeferredDebugImage {
  pending: boolean;
  error: string | null;
}

const emptyDebugImage: DebugImageState = {
  url: null,
  durationMs: 0,
  generationId: 0,
  pending: false,
  error: null,
};

export function useDeferredDebugImage(
  substrate: SubstrateData | null,
  mode: SubstrateDebugMode,
): DebugImageState {
  const [image, setImage] = useState<DebugImageState>(emptyDebugImage);

  useEffect(() => {
    if (!substrate || !["mask", "edge", "distance"].includes(mode)) {
      setImage(emptyDebugImage);
      return;
    }
    let cancelled = false;
    setImage((current) => ({ ...current, url: null, pending: true, error: null }));
    void getDeferredSubstrateDebugImage(substrate, mode)
      .then((result) => {
        if (!cancelled) setImage({ ...result, pending: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          setImage({
            ...emptyDebugImage,
            error: error instanceof Error ? error.message : "Debug image generation failed.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, substrate]);

  return image;
}
