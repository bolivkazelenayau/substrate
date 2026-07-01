import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

export type SvgExportSummary = {
  viewBox: string;
  elementCounts: {
    path: number;
    circle: number;
    line: number;
    polyline: number;
    image: number;
    canvas: number;
    foreignObject: number;
  };
  hasDataImage: boolean;
  hasBase64: boolean;
  canonicalHash: string;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function normalizeElement(element: Element): void {
  for (const child of [...element.childNodes]) {
    if (child.nodeType === 3 && !child.textContent?.trim()) {
      child.remove();
    } else if (child.nodeType === 1) {
      normalizeElement(child as Element);
    }
  }
}

export function canonicalizeSvgForGolden(svg: string): string {
  const document = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  const metadata = document.querySelector("metadata");
  if (metadata?.textContent) {
    const parsed = JSON.parse(metadata.textContent) as Record<string, unknown>;
    delete parsed.exportTimestamp;
    metadata.textContent = JSON.stringify(stableValue(parsed));
  }
  normalizeElement(document.documentElement);
  return document.documentElement.outerHTML.replace(/>\s+</g, "><").trim();
}

export function hashCanonicalSvg(svg: string): string {
  return createHash("sha256").update(canonicalizeSvgForGolden(svg)).digest("hex");
}

export function extractSvgExportSummary(svg: string): SvgExportSummary {
  const document = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  const count = (selector: string) => document.querySelectorAll(selector).length;
  return {
    viewBox: document.documentElement.getAttribute("viewBox") ?? "",
    elementCounts: {
      path: count("path"),
      circle: count("circle"),
      line: count("line"),
      polyline: count("polyline"),
      image: count("image"),
      canvas: count("canvas"),
      foreignObject: count("foreignObject"),
    },
    hasDataImage: /data:image/i.test(svg),
    hasBase64: /(?:;base64,|\bbase64\b)/i.test(svg),
    canonicalHash: hashCanonicalSvg(svg),
  };
}
