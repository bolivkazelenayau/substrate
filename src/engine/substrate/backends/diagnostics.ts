import type { SubstrateBackendStatus } from "./types";

export function getBackendDiagnosticItems(status: SubstrateBackendStatus): string[] {
  const items = [
    status.activeBackend?.toUpperCase() ?? "PENDING",
    status.phase.toUpperCase(),
    `SUPPORT ${status.workerCapability?.status.toUpperCase() ?? "CHECKING"}`,
    `REQ ${status.requestId}`,
    `ACTIVE ${status.activeRequestId ?? "NONE"}`,
    `LATEST ${status.latestRequestedId}`,
    `PENDING ${status.pendingRequestCount}`,
    `COALESCED ${status.coalescedRequestCount}`,
    `DROPPED ${status.droppedObsoleteRequestCount}`,
  ];
  if (status.skippedObsoleteRequest) items.push("SKIPPED OBSOLETE");
  if (status.timing) {
    items.push(
      `TOTAL ${status.timing.totalMs.toFixed(1)}MS`,
      `WORKER ${status.timing.workerComputeMs.toFixed(1)}MS`,
      `MAIN ${status.timing.mainThreadMs.toFixed(1)}MS`,
      `RTT ${status.timing.roundTripMs.toFixed(1)}MS`,
    );
  }
  if (status.fallbackReason) {
    items.push(`${status.fallbackCode?.toUpperCase() ?? "UNKNOWN"}: ${status.fallbackReason}`);
  }
  const creation = status.workerCapability?.creation;
  if (creation && (status.fallbackCode === "worker-constructor-failed" || status.fallbackCode === "worker-unavailable")) {
    items.push(
      `URL ${creation.workerUrl}`,
      `MAIN API W:${creation.workerType} O:${creation.offscreenCanvasType} P:${creation.path2DType}`,
    );
    if (creation.exceptionName || creation.exceptionMessage) {
      items.push(`EXCEPTION ${creation.exceptionName ?? "Error"}: ${creation.exceptionMessage ?? "No message"}`);
    }
  }
  return items;
}
