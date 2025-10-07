import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Payment } from 'src/shards/interfaces';
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
        if (this.configService.get('DISABLE_SYNC_REDIS') == 'true') return;

        const payments = await this.redis.get('payments');
        if (payments) {
            this.payments = (JSON.parse(payments) as Payment[]).map((el) => ({
                ...el,
                date: new Date(el.date),
            }));
        }
    }

    isExists(payment: Payment) {
        return this.payments.some((el) => el.transaction_id == payment.transaction_id);
    }

    replaceDateTodayAndNoTime = (date: Date): Date => {
        const dateMoment: Moment = moment.tz(date, 'Asia/Ho_Chi_Minh');
        const dateNow: Moment = moment().tz('Asia/Ho_Chi_Minh');
        const dateNoTime =
            dateMoment.get('hour') == 0 &&
            dateMoment.get('minute') == 0 &&
            dateMoment.get('second') == 0;

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

        if (replaceDateTimeNewPayments.length == 0) return;

        // Send webhook
        // this.eventEmitter.emit(PAYMENT_CREATED, replaceDateTimeNewPayments);

        this.payments.push(...replaceDateTimeNewPayments);

        // this.payments = this.payments
        //     .slice(-500) // Keep last 500 payments
        //     .sort((a, b) => b.date.getTime() - a.date.getTime());
        // await this.saveRedis();
    }

    sendPayments() {
        const payment: Payment[] = this.getPayments();
        this.eventEmitter.emit(PAYMENT_CREATED, payment);
    }

    getPayments(): Payment[] {
        return this.payments;
    }
}
