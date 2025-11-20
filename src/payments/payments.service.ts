import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Payment } from '../shards/interfaces';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import moment, { Moment } from 'moment-timezone';
import { PAYMENT_CREATED } from '../shards/events';

@Injectable()
export class PaymentsService implements OnApplicationBootstrap {
    private payments: Payment[] = [];
    private redis: Redis;

    constructor(
        private eventEmitter: EventEmitter2,
        private readonly configService: ConfigService,
    ) {
        this.redis = <Redis>this.configService.get('redis');
    }

    async onApplicationBootstrap() {
        if (this.configService.get('DISABLE_SYNC_REDIS') === 'true') {
            return;
        }

        const payments = await this.redis.get('payments');
        if (payments) {
            this.payments = (JSON.parse(payments) as Payment[]).map((el) => ({
                ...el,
                date: new Date(el.date),
            }));
        }
    }

    isExists(payment: Payment) {
        return this.payments.some((el) => el.transaction_id === payment.transaction_id);
    }

    replaceDateTodayAndNoTime = (date: Date): Date => {
        const dateMoment: Moment = moment.tz(date, 'Asia/Ho_Chi_Minh');
        const dateNow: Moment = moment().tz('Asia/Ho_Chi_Minh');
        const dateNoTime =
            dateMoment.get('hour') === 0 &&
            dateMoment.get('minute') === 0 &&
            dateMoment.get('second') === 0;

        if (dateMoment.isSame(dateNow, 'day') && dateNoTime) {
            return new Date();
        }
        return date;
    };

    async saveRedis() {
        await this.redis.set('payments', JSON.stringify(this.payments));
    }

    addPayments(payments: Payment[]) {
        const newPayments = payments.filter((payment) => !this.isExists(payment));
        const replaceDateTimeNewPayments = newPayments.map((payment) => ({
            ...payment,
            date: this.replaceDateTodayAndNoTime(payment.date),
        }));

        if (replaceDateTimeNewPayments.length === 0) {
            return;
        }

        // Send webhook
        this.eventEmitter.emit(PAYMENT_CREATED, replaceDateTimeNewPayments);

        this.payments.push(...replaceDateTimeNewPayments);

        // Save to Redis asynchronously
        this.payments = this.payments
            .slice(-100) // Keep last 100 payments
            .sort((a, b) => b.date.getTime() - a.date.getTime());
        void this.saveRedis();
    }

    // Modified getPayments to support from/to (ISO -> timestamps), sort and limit
    getPayments(options?: { from?: number; to?: number; sort?: 'asc' | 'desc'; limit?: number }) {
        const { from, to, sort, limit } = options || {};
        let result = [...this.payments];

        const extractTime = (p: Payment): number => {
            const anyP = p as any;
            // prefer explicit numeric fields
            if (typeof anyP.time === 'number') {
                return anyP.time;
            }
            if (typeof anyP.timestamp === 'number') {
                return anyP.timestamp;
            }
            if (typeof anyP.createdAt === 'number') {
                return anyP.createdAt;
            }

            // handle Date objects stored in `date`
            if (anyP.date instanceof Date) {
                return anyP.date.getTime();
            }
            if (typeof anyP.date === 'number') {
                return anyP.date;
            }
            if (typeof anyP.date === 'string') {
                const parsed = Date.parse(anyP.date);
                return Number.isNaN(parsed) ? 0 : parsed;
            }

            return 0;
        };

        if (typeof from === 'number') {
            result = result.filter((p) => extractTime(p) >= from);
        }

        if (typeof to === 'number') {
            result = result.filter((p) => extractTime(p) <= to);
        }

        // sort by time (default: descending to return newest first)
        result.sort((a, b) => extractTime(a) - extractTime(b));
        if (!sort || sort === 'desc') {
            result = result.reverse();
        }

        if (typeof limit === 'number' && limit > 0) {
            result = result.slice(0, limit);
        }

        return result;
    }
}
