import { Controller, Get } from '@nestjs/common';
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
    getPayments() {
        return this.paymentService.getPayments();
    }
}
