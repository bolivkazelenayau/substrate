import { createContext, useContext } from "react";

export const ViewportHudHostContext = createContext<HTMLDivElement | null>(null);

export function useViewportHudHost() {
  return useContext(ViewportHudHostContext);
}
