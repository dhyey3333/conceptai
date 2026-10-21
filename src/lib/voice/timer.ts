/** A timeout you can pause and resume, so board animations and silent beats stay in step. */
export class PausableTimer {
  readonly promise: Promise<void>;
  private resolve!: () => void;
  private remaining: number;
  private startedAt = 0;
  private handle: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  constructor(ms: number, startPaused = false) {
    this.remaining = Math.max(0, ms);
    this.promise = new Promise((r) => (this.resolve = r));
    if (!startPaused) this.resume();
  }

  resume(): void {
    if (this.finished || this.handle) return;
    this.startedAt = performance.now();
    this.handle = setTimeout(() => this.finish(), this.remaining);
  }

  pause(): void {
    if (!this.handle) return;
    clearTimeout(this.handle);
    this.handle = null;
    this.remaining = Math.max(0, this.remaining - (performance.now() - this.startedAt));
  }

  /** Resolve now (used when a beat is skipped or cancelled). */
  finish(): void {
    if (this.finished) return;
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
    this.finished = true;
    this.resolve();
  }
}
