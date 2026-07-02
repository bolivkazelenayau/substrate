import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  defaultViewportNavigation,
  panBy,
  resetViewportNavigation,
  zoomAtCenter,
  zoomFromWheel,
  type ViewportNavigationState,
} from "../engine/viewportNavigation";
import {
  getNavigationCompositingMode,
  recordCanvasNavigationRender,
  recordPointerMoveEvent,
  recordViewportActiveUpdate,
  recordWheelEvent,
} from "../dev/viewportNavigationInstrumentation";
import { ViewportHudHostContext } from "./viewportHudContext";

interface CanvasNavigationProps {
  children: ReactNode;
}

const BUTTON_ZOOM_FACTOR = 1.25;
// Cancel any "active interaction" GPU-hint (`will-change: transform`) and the
// panning cursor this many ms after the last wheel/pointer event. Long enough
// to cover the raster settle window after a zoom/pan gesture while still
// freeing the compositor layer during idle editing.
const ACTIVE_INTERACTION_IDLE_MS = 220;

export function CanvasNavigation({ children }: CanvasNavigationProps) {
  recordCanvasNavigationRender();
  const [viewport, setViewport] = useState<ViewportNavigationState>(defaultViewportNavigation);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const [activeInteraction, setActiveInteraction] = useState(false);
  const [hudHost, setHudHost] = useState<HTMLDivElement | null>(null);
  // Read the runtime compositing mode once per mount. The mode is intentionally
  // not reactive: switching it requires a re-mount and is a dev-only escape
  // hatch (see `viewportNavigationInstrumentation.ts`). The default `"crisp"`
  // keeps the SVG/canvas subtree on the native repaint path; `"composited"`
  // promotes it to a GPU layer via `translate3d` + `will-change` + backface
  // visibility, which trades sharpness during the gesture for lower paint
  // cost. The `import.meta.env.DEV` short-circuit makes the composited branch
  // a compile-time `false` in production builds, so the `translate3d` template
  // and `will-change` class are dead-code-eliminated — production ships only
  // the crisp 2D `translate(...) scale(...)` path.
  const composited = import.meta.env.DEV && getNavigationCompositingMode() === "composited";
  const frameRef = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const panPointerId = useRef<number | null>(null);
  // Coalesced viewport state. A burst of native wheel/pointermove events fires
  // inside a single animation frame; rather than calling setViewport once per
  // event (one React commit and one new CSS transform per event), we fold the
  // incremental math into `pendingViewportRef` synchronously and commit at most
  // once per `requestAnimationFrame`. The math is identical to applying each
  // event sequentially — only the commit frequency is throttled.
  const pendingViewportRef = useRef<ViewportNavigationState>(viewport);
  const wheelRafIdRef = useRef<number | null>(null);
  const activeTimeoutIdRef = useRef<number | null>(null);

  const scheduleActiveClear = useCallback(() => {
    if (activeTimeoutIdRef.current !== null) clearTimeout(activeTimeoutIdRef.current);
    activeTimeoutIdRef.current = window.setTimeout(() => {
      setActiveInteraction(false);
      activeTimeoutIdRef.current = null;
    }, ACTIVE_INTERACTION_IDLE_MS);
  }, []);

  const markActiveInteraction = useCallback(() => {
    setActiveInteraction(true);
    scheduleActiveClear();
  }, [scheduleActiveClear]);

  const commitPendingViewport = useCallback(() => {
    wheelRafIdRef.current = null;
    setViewport(pendingViewportRef.current);
    recordViewportActiveUpdate();
  }, []);

  const scheduleViewportCommit = useCallback(() => {
    if (wheelRafIdRef.current !== null) {
      // Replace the pending frame so commit fires as soon as the next vsync —
      // but keep a single in-flight requestAnimationFrame slot.
      cancelAnimationFrame(wheelRafIdRef.current);
    }
    wheelRafIdRef.current = requestAnimationFrame(commitPendingViewport);
  }, [commitPendingViewport]);

  // Apply a viewport update from a non-coalesced source (button controls, FIT,
  // reset). Updates both the pending ref and React state synchronously so the
  // coalesced wheel/pan path stays consistent with the last committed value.
  const applyViewportSync = useCallback(
    (next: ViewportNavigationState) => {
      if (wheelRafIdRef.current !== null) {
        cancelAnimationFrame(wheelRafIdRef.current);
        wheelRafIdRef.current = null;
      }
      pendingViewportRef.current = next;
      setViewport(next);
      recordViewportActiveUpdate();
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (wheelRafIdRef.current !== null) cancelAnimationFrame(wheelRafIdRef.current);
      if (activeTimeoutIdRef.current !== null) clearTimeout(activeTimeoutIdRef.current);
    };
  }, []);

  useEffect(() => {
    const pressSpace = (event: KeyboardEvent) => {
      if (!hovered.current || event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      setSpacePressed(true);
    };
    const releaseSpace = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      setSpacePressed(false);
    };
    const releaseSpaceOnBlur = () => setSpacePressed(false);
    window.addEventListener("keydown", pressSpace);
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", releaseSpaceOnBlur);
    return () => {
      window.removeEventListener("keydown", pressSpace);
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", releaseSpaceOnBlur);
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      recordWheelEvent();
      const bounds = frame.getBoundingClientRect();
      const anchor = {
        x: event.clientX - (bounds.left + bounds.width / 2),
        y: event.clientY - (bounds.top + bounds.height / 2),
      };
      pendingViewportRef.current = zoomFromWheel(pendingViewportRef.current, event.deltaY, anchor);
      markActiveInteraction();
      scheduleViewportCommit();
    };
    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheel);
  }, [markActiveInteraction, scheduleViewportCommit]);

  const zoomBy = useCallback(
    (factor: number) =>
      applyViewportSync(zoomAtCenter(pendingViewportRef.current, pendingViewportRef.current.zoom * factor)),
    [applyViewportSync],
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".canvas-navigation-controls")) return;
    const beginsPan = event.button === 1 || (event.button === 0 && spacePressed);
    if (!beginsPan) return;
    event.preventDefault();
    panPointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
    markActiveInteraction();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (panPointerId.current !== event.pointerId) return;
    event.preventDefault();
    recordPointerMoveEvent();
    pendingViewportRef.current = panBy(pendingViewportRef.current, event.movementX, event.movementY);
    markActiveInteraction();
    scheduleViewportCommit();
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (panPointerId.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panPointerId.current = null;
    setPanning(false);
  };

  // Crisp default: a 2D `translate(...) scale(...)` keeps the SVG subtree on
  // the browser's native repaint path — every committed zoom value re-rasters
  // the vector art sharply, with no pre-rasterized layer texture to upscale.
  // `translate3d` (composited mode) promotes the subtree to a GPU layer; while
  // that cuts paint cost, the compositor upscales the layer texture during the
  // gesture and re-rasterizes only after the gesture ends, producing the
  // observed transient blur on a vector/design surface.
  const transform = composited
    ? `translate3d(${viewport.panX}px, ${viewport.panY}px, 0) scale(${viewport.zoom})`
    : `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
  const interactionClassName = activeInteraction ? " is-active-interaction" : "";
  const compositedClassName = composited ? " is-composited" : "";
  return (
    <div
      ref={frameRef}
      className={`stage-frame canvas-navigation${panning ? " is-panning" : spacePressed ? " can-pan" : ""}`}
      tabIndex={0}
      aria-label="Artwork canvas navigation"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerEnter={() => { hovered.current = true; }}
      onPointerLeave={() => {
        hovered.current = false;
        if (!panning) setSpacePressed(false);
      }}
      onKeyDown={(event) => {
        if (event.code !== "Space" || event.repeat) return;
        event.preventDefault();
        setSpacePressed(true);
      }}
      onKeyUp={(event) => {
        if (event.code !== "Space") return;
        event.preventDefault();
        setSpacePressed(false);
      }}
    >
      <ViewportHudHostContext.Provider value={hudHost}>
        <div
          className={`canvas-navigation-transform${compositedClassName}${interactionClassName}`}
          data-canvas-zoom={viewport.zoom}
          data-navigation-compositing={composited ? "composited" : "crisp"}
          style={{ transform }}
        >
          {children}
        </div>
      </ViewportHudHostContext.Provider>
      <div className="viewport-hud-layer" ref={setHudHost}>
        <div className="canvas-navigation-controls is-interactive" aria-label="Canvas zoom controls">
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)}>−</button>
          <output aria-live="polite" aria-label="Canvas zoom">{Math.round(viewport.zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)}>+</button>
          <button type="button" aria-label="Fit canvas" title="Reset zoom and pan" onClick={() => applyViewportSync(resetViewportNavigation())}>FIT</button>
        </div>
      </div>
    </div>
  );
}
