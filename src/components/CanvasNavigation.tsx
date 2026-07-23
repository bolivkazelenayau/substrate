import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  defaultViewportNavigation,
  fitViewportToContent,
  panBy,
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
import { traceEvent } from "../dev/interactionTrace";

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
  // not reactive: switching it requires a re-mount and is a dev-console escape
  // hatch (see `viewportNavigationInstrumentation.ts`). The default
  // `"composited"` promotes the SVG/canvas subtree to a GPU layer via
  // `translate3d` + backface visibility, with `will-change: transform` gated on
  // active interaction — gesture frames are compositor-cheap texture scaling,
  // and removing the hint after the gesture settles re-rasterizes the scene
  // sharply at the final zoom. `"crisp"` restores the old repaint-per-frame
  // path (sharp in flight, expensive on heavy scenes).
  const composited = getNavigationCompositingMode() === "composited";
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
    traceEvent({
      stage: "navigation.commit",
      phase: "instant",
      detail: {
        zoom: pendingViewportRef.current.zoom,
        panX: pendingViewportRef.current.panX,
        panY: pendingViewportRef.current.panY,
      },
    });
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
      traceEvent({ stage: "navigation.wheel", phase: "instant", detail: { deltaY: event.deltaY, clientX: event.clientX, clientY: event.clientY } });
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

  const fitToStage = useCallback(() => {
    const frame = frameRef.current;
    // Measure the artwork stage (effective rect), not the authored-aspect host.
    const stage = frame?.querySelector<HTMLElement>("[data-testid='viewport-stage']");
    if (!frame || !stage) {
      applyViewportSync(fitViewportToContent({ width: 1, height: 1 }, { width: 1, height: 1 }));
      return;
    }
    // offset* is layout size before the navigation CSS transform, so FIT is
    // independent of the current zoom/pan.
    applyViewportSync(fitViewportToContent(
      { width: frame.clientWidth, height: frame.clientHeight },
      { width: stage.offsetWidth, height: stage.offsetHeight },
    ));
  }, [applyViewportSync]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".canvas-navigation-controls")) return;
    const beginsPan = event.button === 1 || (event.button === 0 && spacePressed);
    if (!beginsPan) return;
    event.preventDefault();
    panPointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
    traceEvent({ stage: "navigation.pointerdown", phase: "instant", detail: { pointerId: event.pointerId, button: event.button } });
    markActiveInteraction();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (panPointerId.current !== event.pointerId) return;
    event.preventDefault();
    recordPointerMoveEvent();
    traceEvent({ stage: "navigation.pointermove", phase: "instant", detail: { pointerId: event.pointerId, movementX: event.movementX, movementY: event.movementY } });
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
    traceEvent({ stage: "navigation.pointerup", phase: "instant", detail: { pointerId: event.pointerId } });
  };

  // Composited default (P0 zoom fix): `translate3d` keeps the preview subtree
  // on a GPU layer, so committed zoom values are compositor-only texture
  // transforms — no per-frame re-raster of a multi-thousand-node SVG scene.
  // The layer may upscale (soften) during the gesture; after the interaction
  // idle timeout removes the `will-change` hint, the browser re-rasterizes the
  // scene sharply at the settled zoom. `"crisp"` mode uses a plain 2D
  // `translate(...) scale(...)`: sharp every frame, but pays a full repaint
  // per committed zoom value.
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
          <button type="button" aria-label="Fit canvas" title="Fit artwork in view" onClick={fitToStage}>FIT</button>
        </div>
      </div>
    </div>
  );
}
