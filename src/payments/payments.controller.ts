import { Controller, Get, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { OnEvent } from '@nestjs/event-emitter';
import { PAYMENT_HISTORY_UPDATED } from '../shards/events';
import { Payment } from '../shards/interfaces';

@Controller('payments')
export class PaymentsController {
    constructor(private readonly paymentService: PaymentsService) {}

    @OnEvent(PAYMENT_HISTORY_UPDATED)
    handlePaymentHistoryUpdateEvent(payments: Payment[]) {
        this.paymentService.addPayments(payments);
    }

    @Get()
    getPayments(
        @Query('from') from?: string, // ISO8601 (e.g. 2023-08-01T00:00:00Z)
        @Query('to') to?: string, // ISO8601 (e.g. 2023-08-31T23:59:59Z)
        @Query('sort') sort?: 'asc' | 'desc', // 'asc' or 'desc' by time
        @Query('limit') limit?: string, // numeric limit of returned items
    ) {
        const options: {
            from?: number;
            to?: number;
            sort?: 'asc' | 'desc';
            limit?: number;
        } = {};

        if (from) {
            const parsed = Date.parse(from); // enforce ISO8601 (Date.parse returns NaN if invalid)
            if (!Number.isNaN(parsed)) {
                options.from = parsed;
            }
        }

        if (to) {
            const parsed = Date.parse(to);
            if (!Number.isNaN(parsed)) {
                options.to = parsed;
            }
        }

        if (sort && (sort === 'asc' || sort === 'desc')) {
            options.sort = sort;
        }

        if (limit) {
            const n = parseInt(limit, 10);
            if (!Number.isNaN(n) && n > 0) {
                options.limit = n;
            }
        }

        return this.paymentService.getPayments(options);
    }
}
