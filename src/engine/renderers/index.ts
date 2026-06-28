import { dotFieldRenderer } from "./dotFieldRenderer";
import { flowLinesRenderer } from "./flowLinesRenderer";
import { rippleLinesRenderer } from "./rippleLinesRenderer";
import { sdfFlowRenderer } from "./sdfFlowRenderer";
import { sdfStreamlinesRenderer } from "./sdfStreamlinesRenderer";
import { sdfContoursRenderer } from "./sdfContoursRenderer";
import { sdfHalftoneRenderer } from "./sdfHalftoneRenderer";
import { waveContoursRenderer } from "./waveContoursRenderer";
import { glyphDiffuserRenderer } from "./glyphDiffuserRenderer";
import type { RendererId } from "../../types";
import type { VectorRenderer } from "./types";

export const renderers: Record<RendererId, VectorRenderer> = {
  flow: flowLinesRenderer,
  ripple: rippleLinesRenderer,
  dots: dotFieldRenderer,
  "sdf-flow": sdfFlowRenderer,
  "sdf-streamlines": sdfStreamlinesRenderer,
  "sdf-contours": sdfContoursRenderer,
  "sdf-halftone": sdfHalftoneRenderer,
  "wave-contours": waveContoursRenderer,
  "glyph-diffuser": glyphDiffuserRenderer,
};

export const rendererList = Object.values(renderers);

export function getRenderer(id: RendererId): VectorRenderer {
  return renderers[id];
}
