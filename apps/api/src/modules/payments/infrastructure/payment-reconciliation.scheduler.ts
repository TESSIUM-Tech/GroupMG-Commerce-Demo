import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ReconcilePaymentsUseCase } from "../application/reconcile-payments.use-case";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "./payments.config";

const RECONCILE_INTERVAL_MS = 60_000;

/** Polls PayPhone for pending payments once a minute; idle when disabled. */
@Injectable()
export class PaymentReconciliationScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly reconcile: ReconcilePaymentsUseCase,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.mode === "disabled") return;
    this.timer = setInterval(() => void this.run(), RECONCILE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.reconcile.execute();
      if (summary.checked > 0) {
        console.log(
          `[API] Payment reconciliation: checked=${summary.checked} settled=${summary.settled} pending=${summary.stillPending} abandoned=${summary.abandoned} flagged=${summary.flagged}${summary.stopped ? " (stopped: PayPhone unavailable)" : ""}`,
        );
      }
    } catch {
      console.error(
        "[API] Payment reconciliation failed; it will retry on the next interval",
      );
    } finally {
      this.running = false;
    }
  }
}
