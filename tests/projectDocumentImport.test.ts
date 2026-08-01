import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { useProjectDocument } from "../src/hooks/useProjectDocument";

describe("project document import state safety", () => {
  it("does not mutate or reset the open project after a failed import", () => {
    let documentApi!: ReturnType<typeof useProjectDocument>;

    function Harness() {
      documentApi = useProjectDocument();
      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Harness)));
    act(() => {
      documentApi!.setProject({ ...baseState, text: "DO NOT RESET", seed: 424242 });
    });
    const before = documentApi!.project;

    expect(() => documentApi!.importUnknown({
      version: 7,
      text: "INVALID",
      renderer: "removed-renderer",
      seed: 1,
    })).toThrow(/Project migration failed/);

    expect(documentApi!.project).toBe(before);
    expect(documentApi!.project).toMatchObject({ text: "DO NOT RESET", seed: 424242 });

    act(() => root.unmount());
    container.remove();
  });
});
