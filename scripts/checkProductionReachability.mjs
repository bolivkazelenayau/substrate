import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionRoot = "src/main.tsx";

// This is intentionally a small reviewed list, not a general dependency
// analyzer. Each entry is an architecture-critical production owner that must
// remain reachable from the composition root.
const reviewedProductionModules = [
  "src/App.tsx",
  "src/components/Viewport.tsx",
  "src/components/CanvasNavigation.tsx",
  "src/components/panels/ArtworkTypographyPanels.tsx",
  "src/engine/sceneLayout.ts",
  "src/engine/exportSvg.ts",
  "src/engine/renderers/index.ts",
  "src/hooks/useSceneLayout.ts",
  "src/hooks/useSizeInteraction.ts",
  "src/engine/sizeDraftPreview.ts",
  "src/engine/sizeDraftScene.ts",
  "src/engine/sizeSceneTransform.ts",
  "src/engine/sizePresentation.ts",
  "src/engine/sizeRendererDraftPolicy.ts",
  "src/engine/sizeDraftRenderer.ts",
  "src/engine/rendererRequirements.ts",
  "src/engine/pipelineStageKeys.ts",
  "src/engine/pipelineTrace.ts",
];

// These files were the removed, test-backed architecture island. Keeping this
// list here prevents a future implementation from being mistaken for active
// product behavior without an explicit architecture decision.
const removedArchitectureModules = [
  "src/hooks/useTypographySizeDraft.ts",
  "src/components/DraftRendererPreview.tsx",
  "src/components/DraftTypographyPreview.tsx",
  "src/components/canvasNavigationContext.ts",
  "src/engine/draftRendererPreview.ts",
  "src/engine/sizeSettlement.ts",
  "src/engine/typographySizePlacement.ts",
  "src/engine/typographyPlacement.ts",
  "src/engine/projectedScenePresentation.ts",
  "src/engine/glyphDomain.ts",
  "src/engine/artboardExpansion.ts",
  "src/hooks/useAutoGrowArtboard.ts",
];

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx"];

function resolveSourceModule(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const rawCandidate = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [rawCandidate];
  const extension = path.extname(rawCandidate);
  if (extension === ".js" || extension === ".jsx") {
    candidates.push(rawCandidate.slice(0, -extension.length));
  }
  if (!extension) {
    for (const candidateExtension of sourceExtensions) candidates.push(`${rawCandidate}${candidateExtension}`);
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && sourceExtensions.includes(path.extname(candidate))) return candidate;
    for (const candidateExtension of sourceExtensions) {
      const indexed = path.join(candidate, `index${candidateExtension}`);
      if (existsSync(indexed)) return indexed;
    }
  }
  return null;
}

function relativeSourceImports(file) {
  const source = readFileSync(file, "utf8");
  const imports = [];
  const importPattern = /(?:from\s*|import\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) imports.push(match[1]);
  return imports;
}

function reachableFromProductionRoot() {
  const rootFile = path.resolve(root, productionRoot);
  const visited = new Set();
  const queue = [rootFile];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const specifier of relativeSourceImports(current)) {
      const resolved = resolveSourceModule(current, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return visited;
}

const reachable = reachableFromProductionRoot();
const unreachable = reviewedProductionModules.filter((relative) => !reachable.has(path.resolve(root, relative)));
const reintroduced = removedArchitectureModules.filter((relative) => existsSync(path.resolve(root, relative)));

if (unreachable.length > 0 || reintroduced.length > 0) {
  if (unreachable.length > 0) {
    console.error("Production reachability guard: reviewed modules are not reachable from src/main.tsx:");
    for (const module of unreachable) console.error(`- ${module}`);
  }
  if (reintroduced.length > 0) {
    console.error("Production reachability guard: removed architecture modules were reintroduced without review:");
    for (const module of reintroduced) console.error(`- ${module}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Production reachability guard passed: ${reviewedProductionModules.length} reviewed owners reachable; removed architecture island absent.`);
}
