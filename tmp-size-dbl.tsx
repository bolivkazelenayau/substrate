import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useSizeInteraction } from "../src/hooks/useSizeInteraction";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const rafs: FrameRequestCallback[] = [];
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => { rafs.push(cb); return rafs.length; };
(globalThis as any).cancelAnimationFrame = () => undefined;

let latest: ReturnType<typeof useSizeInteraction> | null = null;
const commits: number[] = [];
function Harness({ size }: { size: number }) {
  latest = useSizeInteraction(size, "ripple", (v) => commits.push(v));
  return null;
}
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
await act(async () => { root.render(createElement(Harness, { size: 200 })); });

// double-click sequence
const el = document.createElement("input");
el.setPointerCapture = () => undefined;
el.releasePointerCapture = () => undefined;
el.hasPointerCapture = () => false;

act(() => {
  latest!.handlers.onPointerDown(200, 1, el);
  latest!.handlers.onPointerUp(200, 1);
  latest!.handlers.onPointerDown(200, 2, el);
  latest!.handlers.onPointerUp(200, 2);
  latest!.handlers.onDoubleClickReset(200, 148);
});
console.log("after reset", latest!.state, "commits", commits);

await act(async () => { root.render(createElement(Harness, { size: 148 })); });
act(() => { latest!.completeSettlement(); });
console.log("settled", latest!.state);

// subsequent drag
act(() => {
  latest!.handlers.onPointerDown(148, 3, el);
  latest!.handlers.onInput(180, "input");
  latest!.handlers.onInput(220, "input");
});
// flush raf
act(() => { while (rafs.length) rafs.shift()!(0); });
console.log("during drag", latest!.state);

act(() => { latest!.handlers.onPointerUp(220, 3); });
console.log("after release", latest!.state, "commits", commits);
