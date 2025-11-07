import { Controller, Get } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { OnEvent } from '@nestjs/event-emitter';
import { PAYMENT_CREATED } from 'src/shards/events';
import { Payment } from '../shards/interfaces';

@Controller('webhook')
export class WebhookController {
    constructor(private readonly webhookService: WebhookService) {}

    @OnEvent(PAYMENT_CREATED)
    handlePaymentCreatedEvent(payments: Payment[]) {
        this.webhookService.sendPayments(payments);
    }

    @Get('')
    createTestPayment() {
        const now = new Date();
        const txId = `TEST-${now.getTime()}`;

        const payment: Payment = {
            transaction_id: txId,
            content: 'Test payment content (auto-generated)',
            credit_amount: 500000,
            debit_amount: 0,
            date: new Date(),
            account_receiver: '000123456789',
            account_sender: '999987654321',
            name_sender: 'Test Sender',
        };
        this.webhookService.sendPayments([payment]);
        return {
            ok: true,
            message: 'Enqueued test payment (no body accepted)',
            transaction_id: payment.transaction_id,
        };
    }
}
