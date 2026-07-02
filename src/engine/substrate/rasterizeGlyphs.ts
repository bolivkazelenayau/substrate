import type { RasterMask, SubstrateBuildInput, SubstrateType } from "./types";
import { DEFAULT_ARTBOARD } from "../artboard";

export interface RasterContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  fontKerning?: CanvasFontKerning;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fill(path: unknown): void;
  fillText(text: string, x: number, y: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
}

export interface RasterSurface {
  context: RasterContext;
  createPath(pathData: string): unknown;
}

export type RasterSurfaceFactory = (width: number, height: number) => RasterSurface;

export const browserRasterSurfaceFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("A 2D canvas context is unavailable.");
  return {
    context: context as unknown as RasterContext,
    createPath: (pathData) => new Path2D(pathData),
  };
};

export function rasterizeGlyphs(input: SubstrateBuildInput, factory: RasterSurfaceFactory = browserRasterSurfaceFactory): { mask: RasterMask; substrateType: SubstrateType } {
  const { width, height } = input.resolution;
  const surface = factory(width, height);
  const context = surface.context;
  const viewport = input.viewport ?? DEFAULT_ARTBOARD;
  const domain = input.domainBounds ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const scaleX = width / domain.width;
  const scaleY = height / domain.height;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "black";
  context.fillRect(0, 0, width, height);
  context.setTransform(scaleX, 0, 0, scaleY, -domain.x * scaleX, -domain.y * scaleY);
  context.fillStyle = "white";

  let substrateType: SubstrateType = "empty";
  if (input.textGeometry?.hasOutlines) {
    input.textGeometry.glyphs.forEach((glyph) => {
      if (glyph.path.d) context.fill(surface.createPath(glyph.path.d));
    });
    substrateType = "glyph-paths";
  } else if (input.sourceText.length > 0) {
    context.font = `${input.fontWeight} ${input.fontSize}px ${input.fontFamily}`;
    if (input.kerningMode === "none" && "fontKerning" in context) context.fontKerning = "none";
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(input.sourceText, input.textX, input.baselineY);
    substrateType = "native-text-fallback";
  }

  const pixels = context.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = pixels[index * 4] / 255;
  }
  return { mask: { width, height, data }, substrateType };
}
