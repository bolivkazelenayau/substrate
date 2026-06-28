export interface LatestOnlySchedulerSnapshot {
  activeRequestId: number | null;
  latestRequestedId: number;
  pendingRequestCount: 0 | 1;
  coalescedRequestCount: number;
  droppedObsoleteRequestCount: number;
  skippedObsoleteRequest: boolean;
}

export interface LatestOnlyRequest<TInput, TResult> {
  id: number;
  input: TInput;
  run(input: TInput): Promise<TResult>;
  complete(result: TResult, stale: boolean): void;
  fail(error: unknown, stale: boolean): void;
}

export class LatestOnlyScheduler<TInput, TResult> {
  private active: LatestOnlyRequest<TInput, TResult> | null = null;
  private pending: LatestOnlyRequest<TInput, TResult> | null = null;
  private latestRequestedId = 0;
  private coalescedRequestCount = 0;
  private droppedObsoleteRequestCount = 0;
  private skippedObsoleteRequest = false;

  constructor(private readonly onChange?: (snapshot: LatestOnlySchedulerSnapshot) => void) {}

  schedule(request: LatestOnlyRequest<TInput, TResult>) {
    this.latestRequestedId = request.id;
    this.skippedObsoleteRequest = false;
    if (this.active) {
      this.coalescedRequestCount += 1;
      if (this.pending) {
        this.droppedObsoleteRequestCount += 1;
        this.skippedObsoleteRequest = true;
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
    };
  }

  private async start(request: LatestOnlyRequest<TInput, TResult>) {
    this.active = request;
    this.emit();
    try {
      const result = await request.run(request.input);
      const stale = request.id !== this.latestRequestedId;
      if (stale) {
        this.droppedObsoleteRequestCount += 1;
        this.skippedObsoleteRequest = true;
        this.emit();
      }
      request.complete(result, stale);
    } catch (error) {
      request.fail(error, request.id !== this.latestRequestedId);
    } finally {
      if (this.active?.id === request.id) this.active = null;
      const next = this.pending;
      this.pending = null;
      this.emit();
      if (next) void this.start(next);
    }
  }

  private emit() {
    this.onChange?.(this.snapshot());
  }
}
