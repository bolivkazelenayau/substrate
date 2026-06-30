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
