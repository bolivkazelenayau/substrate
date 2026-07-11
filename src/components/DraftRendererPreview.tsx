import { memo, useId } from "react";
import type { VectorGeometry } from "../engine/geometry";
import type { DraftRenderInput } from "../engine/draftRendererPreview";
import { getTextLayout, textAttributes } from "../engine/textLayout";
import { DraftTypographyPreview } from "./DraftTypographyPreview";

interface Props {
  input: DraftRenderInput;
  presentationTransform: string;
}

/**
 * Immutable visual revision. Geometry, mask, and appearance all come from the
 * same gesture-start snapshot and receive one presentation transform together.
 */
export const DraftRendererPreview = memo(function DraftRendererPreview({ input, presentationTransform }: Props) {
  const { snapshot } = input;
  const frozenGeometry = snapshot.geometry.geometries;
  const clipId = `draft-renderer-clip-${useId().replace(/:/g, "")}`;
  if (frozenGeometry.length === 0) {
    return <g transform={presentationTransform}><DraftTypographyPreview target={snapshot.typography} color={snapshot.appearance.primaryColor} /></g>;
  }

  return <g
    data-draft-renderer-preview={snapshot.rendererId}
    data-draft-preview-quality={input.previewQuality}
    data-draft-key={input.draftKey}
    data-geometry-revision={snapshot.geometryRevisionKey}
    data-mask-revision={snapshot.geometryRevisionKey}
    data-gesture-start-size={snapshot.gestureStartSize}
    data-draft-scale={input.scale}
    fill={snapshot.appearance.primaryColor}
    stroke={snapshot.appearance.primaryColor}
    strokeWidth={snapshot.appearance.strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    clipPath={snapshot.mask.enabled ? `url(#${clipId})` : undefined}
    transform={presentationTransform}
  >
    {snapshot.mask.enabled && <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse">
      <DraftClip input={input} />
    </clipPath></defs>}
    {frozenGeometry.map((item, index) => <DraftGeometryElement key={index} geometry={item} />)}
  </g>;
});

function DraftClip({ input }: { input: DraftRenderInput }) {
  const frozenMask = input.snapshot.mask.typography;
  if (frozenMask.geometry?.hasOutlines) {
    return <>{frozenMask.geometry.glyphs.map((glyph) => glyph.path.d
      ? <path key={glyph.textIndex} d={glyph.path.d} fillRule="evenodd" />
      : null)}</>;
  }
  const layout = getTextLayout(frozenMask.project, false);
  return <text {...textAttributes(layout)}>{layout.text}</text>;
}

function DraftGeometryElement({ geometry }: { geometry: VectorGeometry }) {
  if (geometry.type === "circle") {
    return <circle cx={geometry.center.x} cy={geometry.center.y} r={geometry.radius} opacity={geometry.opacity} />;
  }
  if (geometry.type === "line") {
    return <line x1={geometry.start.x} y1={geometry.start.y} x2={geometry.end.x} y2={geometry.end.y} opacity={geometry.opacity} />;
  }
  if (geometry.type === "polyline") {
    return <polyline fill="none" points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")} opacity={geometry.opacity} />;
  }
  return <path d={geometry.d} opacity={geometry.opacity} />;
}
