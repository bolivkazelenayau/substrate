export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface ScenePoint {
  x: number;
  y: number;
}

export interface ProjectedScenePresentation {
  capturedCenterScreen: ScenePoint;
  projectedCenterScreen: ScenePoint;
  deltaScreen: ScenePoint;
  deltaWorld: ScenePoint;
}

export const IDENTITY_AFFINE_MATRIX: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function mapWorldPoint(matrix: AffineMatrix, point: ScenePoint): ScenePoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

/** Presentation-only correction. It never enters ProjectState or export identity. */
export function resolveProjectedScenePresentation(
  camera: AffineMatrix,
  capturedWorldCenter: ScenePoint,
  projectedWorldCenter: ScenePoint,
): ProjectedScenePresentation {
  const capturedCenterScreen = mapWorldPoint(camera, capturedWorldCenter);
  const projectedCenterScreen = mapWorldPoint(camera, projectedWorldCenter);
  const deltaScreen = {
    x: capturedCenterScreen.x - projectedCenterScreen.x,
    y: capturedCenterScreen.y - projectedCenterScreen.y,
  };
  const determinant = camera.a * camera.d - camera.b * camera.c;
  const deltaWorld = Math.abs(determinant) < 1e-12
    ? { x: capturedWorldCenter.x - projectedWorldCenter.x, y: capturedWorldCenter.y - projectedWorldCenter.y }
    : {
        x: (camera.d * deltaScreen.x - camera.c * deltaScreen.y) / determinant,
        y: (-camera.b * deltaScreen.x + camera.a * deltaScreen.y) / determinant,
      };
  return { capturedCenterScreen, projectedCenterScreen, deltaScreen, deltaWorld };
}
