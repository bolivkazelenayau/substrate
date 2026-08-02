import type { FieldControlId, RendererId } from "../../types";

export type RendererDependencyKey =
  | "text"
  | "typography"
  | "textGeometry"
  | "substrate"
  | "time"
  | "seed"
  | "field"
  | "emitters"
  | "emitterDisplay"
  | "emitterMicroResponse"
  | "glyphDisplacement"
  | "displayDislocation"
  | "appearance"
  | "diffuser"
  | "contours"
  | "halftone"
  | "glyphModulation"
  | "warp"
  | "debug";

export type RendererCategory =
  | "flow"
  | "sdf"
  | "contour"
  | "dot"
  | "diffusion"
  | "experimental";

export type RendererManifest = {
  id: RendererId;
  label: string;
  category: RendererCategory;
  outputKind: "geometry";
  usesTime: boolean;
  usesSubstrate: boolean;
  dependencies: readonly RendererDependencyKey[];
  supportedControls: readonly FieldControlId[];
  /** Centralized renderer audit for the active glyph-domain authority. */
  glyphDomainDisplacement: "supported" | "base-only" | "unsupported";
  /** Post-candidate circle/SDF contract for Emitter Micro Response. */
  emitterMicroResponse: "supported" | "unaffected" | "unsupported";
  graphNode?: {
    category: "renderer";
    outputKind: "geometry";
    experimental?: boolean;
  };
};

const manifest = (
  value: Omit<RendererManifest, "outputKind" | "graphNode">,
): RendererManifest => ({
  ...value,
  outputKind: "geometry",
  graphNode: { category: "renderer", outputKind: "geometry" },
});

export const rendererManifests = {
  flow: manifest({
    id: "flow",
    label: "Flow lines",
    category: "flow",
    usesTime: true,
    usesSubstrate: false,
    dependencies: ["typography", "time", "seed"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "unaffected",
    supportedControls: ["density", "amplitude", "frequency", "turbulence", "edgeInfluence", "maxNodes"],
  }),
  ripple: manifest({
    id: "ripple",
    label: "Ripple lines",
    category: "flow",
    usesTime: false,
    usesSubstrate: false,
    dependencies: ["typography", "seed"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "unaffected",
    supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  }),
  dots: manifest({
    id: "dots",
    label: "Dot field",
    category: "dot",
    usesTime: false,
    usesSubstrate: false,
    dependencies: ["typography", "seed"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "unsupported",
    supportedControls: ["density", "edgeInfluence", "maxNodes"],
  }),
  "sdf-flow": manifest({
    id: "sdf-flow",
    label: "SDF Flow",
    category: "sdf",
    usesTime: false,
    usesSubstrate: true,
    dependencies: ["typography", "substrate", "seed"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "unsupported",
    supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  }),
  "sdf-streamlines": manifest({
    id: "sdf-streamlines",
    label: "SDF Streamlines",
    category: "sdf",
    usesTime: false,
    usesSubstrate: true,
    dependencies: ["typography", "substrate", "seed", "field", "glyphModulation"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "unsupported",
    supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  }),
  "sdf-contours": manifest({
    id: "sdf-contours",
    label: "SDF Contours",
    category: "contour",
    usesTime: false,
    usesSubstrate: true,
    dependencies: ["substrate", "seed", "field", "contours", "glyphModulation"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "unsupported",
    supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  }),
  "sdf-halftone": manifest({
    id: "sdf-halftone",
    label: "SDF Halftone",
    category: "sdf",
    usesTime: false,
    usesSubstrate: true,
    dependencies: ["textGeometry", "substrate", "seed", "field", "emitters", "emitterDisplay", "emitterMicroResponse", "displayDislocation", "halftone", "glyphModulation"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "supported",
    supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  }),
  "wave-contours": manifest({
    id: "wave-contours",
    label: "Wave Contours",
    category: "contour",
    usesTime: false,
    usesSubstrate: true,
    dependencies: ["substrate", "field", "emitters", "contours"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "unaffected",
    supportedControls: ["density", "amplitude", "frequency", "edgeInfluence", "maxNodes"],
  }),
  "glyph-diffuser": manifest({
    id: "glyph-diffuser",
    label: "Glyph Diffuser",
    category: "diffusion",
    usesTime: false,
    usesSubstrate: true,
    dependencies: ["textGeometry", "substrate", "seed", "field", "emitters", "emitterDisplay", "emitterMicroResponse", "diffuser"],
    glyphDomainDisplacement: "supported",
    emitterMicroResponse: "supported",
    supportedControls: ["density", "amplitude", "frequency", "turbulence", "edgeInfluence", "maxNodes"],
  }),
} satisfies Record<RendererId, RendererManifest>;

export function getRendererManifest(id: RendererId): RendererManifest {
  return rendererManifests[id];
}
