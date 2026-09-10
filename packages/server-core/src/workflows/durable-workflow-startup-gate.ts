/** No workflow admission may infer absence while recovery storage is unavailable. */
export class DurableWorkflowStartupGate {
  private pending = false;
  defer(): void { this.pending = true; }
  allowsScheduledWork(): boolean { return !this.pending; }
  assertAdmissionAvailable(): void {
    if (this.pending) throw new Error('Workflow recovery is unavailable. Restore the local durable host before starting or rerunning workflows.');
  }
  finish(hostAvailable: boolean): boolean {
    if (!hostAvailable) return false;
    this.pending = false;
    return true;
  }
}
