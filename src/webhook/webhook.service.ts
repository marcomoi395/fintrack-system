import { Injectable, Logger } from '@nestjs/common';
import { axios } from 'src/shards/helpers/axios';
import { Payment, Webhook, WebhookEnvelope } from '../shards/interfaces';
import { Job, Queue, Worker, ConnectionOptions } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { webhookConfig } from '../shards/utils/webhook-config.util';

type JobData = { envelope: WebhookEnvelope<Payment> };

@Injectable()
export class WebhookService {
    private logger = new Logger(WebhookService.name);
    private readonly webhook: Webhook;
    private readonly queue: Queue<JobData>;
    private readonly connection: ConnectionOptions;

    constructor(private readonly cfg: ConfigService) {
        const connection = this.cfg.get<ConnectionOptions>('redis');

        if (!connection) {
            throw new Error('Redis connection is not configured');
        }
        this.queue = new Queue('webhook', {
            connection,
            defaultJobOptions: {
                removeOnComplete: {
                    age: 1000 * 60 * 60 * 24 * 3,
                },
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000 * 60,
                },
            },
        });

        this.connection = connection;
        this.webhook = webhookConfig(cfg);
        this.createWorker();
    }

    createWorker() {
        const worker = new Worker(
            'webhook',
            async (job: Job<JobData>) => {
                const { url, token } = this.webhook;
                const { envelope } = job.data;

                await axios.post(url, envelope, {
                    headers: {
                        'X-Log-Token': token,
                    },
                });
            },
            { connection: this.connection, concurrency: 5 },
        );

        worker.on('completed', (job) => {
            this.logger.log(`Job ${job.id} completed`);
        });

        worker.on('failed', (job, err) => {
            if (!job) {
                this.logger.error(`A job failed but job data is undefined: ${err.message}`);
                return;
            }

            this.logger.error(`Job ${job.id} failed with ${err.message}`);
        });
    }

    sendPayments(payments: Payment[]) {
        payments.forEach((payment) => {
            const envelope: WebhookEnvelope<Payment> = {
                event: 'payment.created',
                version: 1,
                occurred_at: new Date().toISOString(),
                source: this.cfg.get<string>('APP_NAME') || 'payment-gateway',
                data: payment,
            };

            void this.queue.add(
                'webhook',
                { envelope },
                {
                    jobId: `${payment.transaction_id}`,
                },
            );
        });
    }
}
