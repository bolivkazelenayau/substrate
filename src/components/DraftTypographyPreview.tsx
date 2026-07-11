import { getTextLayout, textAttributes } from "../engine/textLayout";
import type { TypographySizePlacement } from "../engine/typographySizePlacement";

interface Props {
  target: TypographySizePlacement;
  color: string;
}

/** Exact, lightweight typography shown while final renderer topology is stale. */
export function DraftTypographyPreview({ target, color }: Props) {
  if (target.geometry?.hasOutlines) {
    return <g
      data-draft-typography-preview="parsed-outlines"
      className="draft-typography-preview"
      fill={color}
      fillRule="evenodd"
      opacity={0.72}
    >
      {target.geometry.glyphs.map((glyph) => glyph.path.d
        ? <path key={glyph.textIndex} d={glyph.path.d} />
        : null)}
    </g>;
  }

  const layout = getTextLayout(target.project);
  return <text
    data-draft-typography-preview="native-text"
    className="draft-typography-preview"
    fill={color}
    opacity={0.72}
    {...textAttributes(layout)}
  >{layout.text}</text>;
}
