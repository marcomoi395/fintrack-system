import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Gate, Payment } from '../shards/interfaces';
import {
    GATEWAY_CRON_ERROR_STREAK,
    GATEWAY_CRON_RECOVERY,
    PAYMENT_HISTORY_UPDATED,
} from '../shards/events';
import { sleep } from '../shards/helpers/sleep';
import { CaptchaSolverService } from '../capcha-solver/captcha-solver.service';
import cron from 'node-cron';

@Injectable()
abstract class GatewayService {
    private logger = new Logger(GatewayService.name);
    private isCronRunning = false;
    private errorStreak = 0;
    private isErrored = false;
    private cronTimer?: NodeJS.Timeout;
    private cooldownTimer?: NodeJS.Timeout;

    protected constructor(
        protected readonly config: Gate,
        protected readonly eventEmitter: EventEmitter2,
        protected readonly captchaSolver: CaptchaSolverService,
    ) {}

    onApplicationBootstrap() {
        cron.schedule(
            '00 19 * * *',
            async () => {
                await this.triggerSync();
            },
            {
                timezone: 'Asia/Ho_Chi_Minh',
            },
        );
    }

    getName() {
        return this.config.name;
    }

    abstract getHistory(): Promise<Payment[]>;

    private safeErrorMessage(err: unknown): string {
        if (err instanceof Error) {
            return err.message;
        }
        if (typeof err === 'string') {
            return err;
        }
        try {
            return JSON.stringify(err);
        } catch {
            return String(err);
        }
    }

    private scheduleNext(runAfterMs: number) {
        if (!this.isCronRunning) {
            return;
        }
        clearTimeout(this.cronTimer);
        this.cronTimer = setTimeout(() => void this.runOnce(), runAfterMs);
    }

    private handleError(
        err: unknown,
        opt: { mode?: 'cron' | 'manual'; retry?: boolean } = { mode: 'cron' },
    ) {
        const msg = this.safeErrorMessage(err);

        this.logger.error(
            `[${this.getName()}] ${msg}`,
            err instanceof Error ? err.stack : undefined,
        );

        if (opt.mode === 'manual') {
            // chỉ log, không schedule, không tăng streak
            if (opt.retry) {
                // nếu muốn manual vẫn auto-retry (ví dụ khi /sync gọi executeOnce lặp)
                this.logger.warn(`[${this.getName()}] retrying manual sync in 10s`);
                setTimeout(() => void this.triggerSync(), 10000);
            }
            return;
        }

        this.errorStreak += 1;

        if (this.errorStreak > 5) {
            if (!this.isErrored) {
                this.isErrored = true;
            }
            this.eventEmitter.emit(GATEWAY_CRON_ERROR_STREAK, {
                name: this.getName(),
                error: msg,
            });

            // cooldown 5 phút rồi chạy lại
            clearTimeout(this.cooldownTimer);
            this.cooldownTimer = setTimeout(
                () => {
                    if (!this.isCronRunning) {
                        return;
                    }
                    this.errorStreak = 0;
                    this.scheduleNext(0);
                },
                5 * 60 * 1000,
            );
        } else {
            // retry nhanh 10s
            this.scheduleNext(20 * 1000);
        }
    }

    private async runOnce() {
        try {
            const payments = await this.getHistory();
            this.eventEmitter.emit(PAYMENT_HISTORY_UPDATED, payments);

            if (this.isErrored) {
                this.eventEmitter.emit(GATEWAY_CRON_RECOVERY, { name: this.getName() });
            }
            this.isErrored = false;
            this.errorStreak = 0;

            await sleep(this.config.repeat_interval_in_sec * 1000);
            this.scheduleNext(0);
        } catch (err) {
            this.handleError(err, { mode: 'cron' });
        }
    }

    private async executeOnce() {
        try {
            const payments = await this.getHistory();
            this.eventEmitter.emit(PAYMENT_HISTORY_UPDATED, payments);

            if (this.isErrored) {
                this.eventEmitter.emit(GATEWAY_CRON_RECOVERY, { name: this.getName() });
            }
            this.isErrored = false;
            this.errorStreak = 0;
        } catch (err) {
            this.handleError(err, { mode: 'manual' });
        }
    }

    startCron() {
        if (this.isCronRunning) {
            this.logger.warn(`[${this.getName()}] cron already running, skip start`);
            return;
        }
        this.isCronRunning = true;
        this.logger.log(`[${this.getName()}] cron started`);
        this.scheduleNext(0);
    }

    stopCron() {
        this.isCronRunning = false;
        clearTimeout(this.cronTimer);
        clearTimeout(this.cooldownTimer);
        this.logger.log(`[${this.getName()}] cron stopped`);
    }

    async triggerSync() {
        if (this.isCronRunning) {
            this.logger.warn(`[${this.getName()}] cron is running, cannot trigger sync`);
            return;
        }

        this.isCronRunning = true;
        try {
            await this.executeOnce();
            return { ok: true };
        } catch (err) {
            const msg = this.safeErrorMessage(err);
            this.logger.error(`[${this.getName()}] manual sync failed: ${msg}`);
            throw err;
        } finally {
            this.isCronRunning = false;
        }
    }
}

export default GatewayService;
