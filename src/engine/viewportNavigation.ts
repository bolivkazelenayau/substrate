export const MIN_VIEWPORT_ZOOM = 0.25;
export const MAX_VIEWPORT_ZOOM = 8;
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export interface ViewportNavigationState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export const defaultViewportNavigation: ViewportNavigationState = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

export function clampZoom(zoom: number) {
  return Math.min(MAX_VIEWPORT_ZOOM, Math.max(MIN_VIEWPORT_ZOOM, zoom));
}

export function zoomAtPoint(
  state: ViewportNavigationState,
  requestedZoom: number,
  anchor: ViewportPoint,
): ViewportNavigationState {
  const zoom = clampZoom(requestedZoom);
  if (zoom === state.zoom) return state;
  const worldX = (anchor.x - state.panX) / state.zoom;
  const worldY = (anchor.y - state.panY) / state.zoom;
  return {
    zoom,
    panX: anchor.x - worldX * zoom,
    panY: anchor.y - worldY * zoom,
  };
}

export function zoomAtCenter(state: ViewportNavigationState, requestedZoom: number) {
  return zoomAtPoint(state, requestedZoom, { x: 0, y: 0 });
}

export function zoomFromWheel(state: ViewportNavigationState, deltaY: number, anchor: ViewportPoint) {
  return zoomAtPoint(state, state.zoom * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY), anchor);
}

export function panBy(state: ViewportNavigationState, deltaX: number, deltaY: number): ViewportNavigationState {
  return { ...state, panX: state.panX + deltaX, panY: state.panY + deltaY };
}

export function resetViewportNavigation(): ViewportNavigationState {
  return { ...defaultViewportNavigation };
}

/**
 * Zoom/pan so `content` (untransformed stage CSS box) fits inside `frame`.
 *
 * After authored-stable stage scaling, zoom=1 no longer means "fit everything":
 * the stage can be larger than the frame when the effective artboard grows
 * (e.g. multi-line line-height). FIT must recompute zoom from real sizes.
 * Pan is cleared so the content stays centered via the transform origin.
 */
export function fitViewportToContent(
  frame: { width: number; height: number },
  content: { width: number; height: number },
  padding = 1,
): ViewportNavigationState {
  if (
    !(frame.width > 0)
    || !(frame.height > 0)
    || !(content.width > 0)
    || !(content.height > 0)
    || !(padding > 0)
  ) {
    return resetViewportNavigation();
  }
  const zoom = clampZoom(
    Math.min(frame.width / content.width, frame.height / content.height) * padding,
  );
  return { zoom, panX: 0, panY: 0 };
}
