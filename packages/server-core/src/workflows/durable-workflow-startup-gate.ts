/** Scheduled scans must not infer absence before an enabled journal can be read. */
export class DurableWorkflowStartupGate {
  private pending = false;
  defer(): void { this.pending = true; }
  allowsScheduledWork(): boolean { return !this.pending; }
  finish(hostAvailable: boolean): boolean {
    if (!hostAvailable) return false;
    this.pending = false;
    return true;
  }
}
