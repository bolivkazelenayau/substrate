import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  defaultViewportNavigation,
  panBy,
  resetViewportNavigation,
  zoomAtCenter,
  zoomFromWheel,
} from "../engine/viewportNavigation";

interface CanvasNavigationProps {
  children: ReactNode;
}

const BUTTON_ZOOM_FACTOR = 1.25;

export function CanvasNavigation({ children }: CanvasNavigationProps) {
  const [viewport, setViewport] = useState(defaultViewportNavigation);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const panPointerId = useRef<number | null>(null);

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
      const bounds = frame.getBoundingClientRect();
      const anchor = {
        x: event.clientX - (bounds.left + bounds.width / 2),
        y: event.clientY - (bounds.top + bounds.height / 2),
      };
      setViewport((current) => zoomFromWheel(current, event.deltaY, anchor));
    };
    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheel);
  }, []);

  const zoomBy = (factor: number) =>
    setViewport((current) => zoomAtCenter(current, current.zoom * factor));

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".canvas-navigation-controls")) return;
    const beginsPan = event.button === 1 || (event.button === 0 && spacePressed);
    if (!beginsPan) return;
    event.preventDefault();
    panPointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (panPointerId.current !== event.pointerId) return;
    event.preventDefault();
    setViewport((current) => panBy(current, event.movementX, event.movementY));
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (panPointerId.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panPointerId.current = null;
    setPanning(false);
  };

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
      <div
        className="canvas-navigation-transform"
        data-canvas-zoom={viewport.zoom}
        style={{
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
        }}
      >
        {children}
      </div>
      <div className="canvas-navigation-controls" aria-label="Canvas zoom controls">
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)}>−</button>
        <output aria-live="polite" aria-label="Canvas zoom">{Math.round(viewport.zoom * 100)}%</output>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)}>+</button>
        <button type="button" aria-label="Fit canvas" title="Reset zoom and pan" onClick={() => setViewport(resetViewportNavigation())}>FIT</button>
      </div>
    </div>
  );
}
