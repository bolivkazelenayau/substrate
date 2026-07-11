import { createContext, useContext } from "react";
import { IDENTITY_AFFINE_MATRIX, type AffineMatrix } from "../engine/projectedScenePresentation";

export interface CanvasNavigationSnapshot {
  zoom: number;
  panX: number;
  panY: number;
  matrix: AffineMatrix;
}

const DEFAULT_SNAPSHOT: CanvasNavigationSnapshot = {
  zoom: 1,
  panX: 0,
  panY: 0,
  matrix: IDENTITY_AFFINE_MATRIX,
};

export const CanvasNavigationContext = createContext(DEFAULT_SNAPSHOT);
export const useCanvasNavigationSnapshot = () => useContext(CanvasNavigationContext);
