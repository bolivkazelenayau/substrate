export type RequestCompletion = "success" | "failure" | "superseded" | "disposed";

export interface LatestOnlySchedulerSnapshot {
  activeRequestId: number | null;
  latestRequestedId: number;
  pendingRequestCount: 0 | 1;
  coalescedRequestCount: number;
  droppedObsoleteRequestCount: number;
  skippedObsoleteRequest: boolean;
  /** True when the scheduler has been disposed and will not start new work. */
  disposed: boolean;
}

export interface LatestOnlyRequest<TInput, TResult> {
  id: number;
  input: TInput;
  run(input: TInput): Promise<TResult>;
  complete(result: TResult, stale: boolean): void;
  fail(error: unknown, stale: boolean): void;
  /** Invoked when this request is replaced by a newer pending request before it started. */
  supersede?(reason: string): void;
  /** Invoked when the scheduler is disposed and this request will never run. */
  dispose?(reason: string): void;
}

export class LatestOnlyScheduler<TInput, TResult> {
  private active: LatestOnlyRequest<TInput, TResult> | null = null;
  private pending: LatestOnlyRequest<TInput, TResult> | null = null;
  private latestRequestedId = 0;
  private coalescedRequestCount = 0;
  private droppedObsoleteRequestCount = 0;
  private skippedObsoleteRequest = false;
  private disposed = false;

  constructor(private readonly onChange?: (snapshot: LatestOnlySchedulerSnapshot) => void) {}

  schedule(request: LatestOnlyRequest<TInput, TResult>) {
    if (this.disposed) {
      this.safeInvoke(() => request.dispose?.("scheduler-disposed"));
      return;
    }
    this.latestRequestedId = request.id;
    this.skippedObsoleteRequest = false;
    if (this.active) {
      this.coalescedRequestCount += 1;
      if (this.pending) {
        this.droppedObsoleteRequestCount += 1;
        this.skippedObsoleteRequest = true;
        this.safeInvoke(() => this.pending!.supersede?.("replaced-by-newer"));
      }
      this.pending = request;
      this.emit();
      return;
    }
    void this.start(request);
  }

  snapshot(): LatestOnlySchedulerSnapshot {
    return {
      activeRequestId: this.active?.id ?? null,
      latestRequestedId: this.latestRequestedId,
      pendingRequestCount: this.pending ? 1 : 0,
      coalescedRequestCount: this.coalescedRequestCount,
      droppedObsoleteRequestCount: this.droppedObsoleteRequestCount,
      skippedObsoleteRequest: this.skippedObsoleteRequest,
      disposed: this.disposed,
    };
  }

  /**
   * Clears pending work and marks any in-flight active work as stale. Active work
   * is allowed to finish, but its result must be ignored by callers because its
   * request id is now behind `latestRequestedId`.
   */
  reset() {
    if (this.pending) {
      this.safeInvoke(() => this.pending!.supersede?.("stage-reset"));
      this.pending = null;
    }
    this.latestRequestedId += 1;
    this.skippedObsoleteRequest = true;
    this.emit();
  }

  /**
   * Disposes the scheduler. Pending requests are completed as disposed. Already
   * active work may continue, but its completion will be reported as stale.
   * No new work may start after disposal.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pending) {
      this.safeInvoke(() => this.pending!.dispose?.("scheduler-disposed"));
      this.pending = null;
    }
    this.latestRequestedId += 1;
    this.skippedObsoleteRequest = true;
    this.emit();
  }

  private async start(request: LatestOnlyRequest<TInput, TResult>) {
    this.active = request;
    this.emit();
    try {
      const result = await request.run(request.input);
      const stale = request.id !== this.latestRequestedId || this.disposed;
      if (stale) {
        this.droppedObsoleteRequestCount += 1;
        this.skippedObsoleteRequest = true;
        this.emit();
      }
      this.safeInvoke(() => request.complete(result, stale));
    } catch (error) {
      this.safeInvoke(() => request.fail(error, request.id !== this.latestRequestedId || this.disposed));
    } finally {
      if (this.active?.id === request.id) this.active = null;
      const next = this.disposed ? null : this.pending;
      this.pending = null;
      this.emit();
      if (next) void this.start(next);
    }
  }

  private safeInvoke(callback: () => void) {
    try {
      callback();
    } catch {
      // Request callbacks must not corrupt scheduler state.
    }
  }

  private emit() {
    this.onChange?.(this.snapshot());
  }
}
