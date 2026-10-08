import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ReleaseExpiredReservationsUseCase } from "../application/release-expired-reservations.use-case";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Periodically releases expired reservations. Releasing is idempotent and
 * row-locked, so overlapping sweeps or several API processes are safe.
 */
@Injectable()
export class ReservationExpiryScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly release: ReleaseExpiredReservationsUseCase) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const released = await this.release.execute();
      if (released.reservations > 0) {
        console.log(
          `[API] Released ${released.reservations} expired reservations; ${released.orders} orders expired`,
        );
      }
    } catch {
      console.error(
        "[API] Reservation expiry sweep failed; it will retry on the next interval",
      );
    } finally {
      this.running = false;
    }
  }
}
