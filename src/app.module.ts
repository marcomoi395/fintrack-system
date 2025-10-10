import { Module } from '@nestjs/common';
import { PaymentsModule } from './payments/payments.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '@nestjs/config';
import { GatewayModule } from './gateway/gateway.module';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookService } from './webhook/webhook.service';
import { WebhookModule } from './webhook/webhook.module';
import configuration from './configuration';
import Joi from 'joi';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            validationSchema: Joi.object({
                NODE_ENV: Joi.string().valid('development', 'production').default('development'),
                PORT: Joi.number().default(3000),
                CAPTCHA_API_BASE_URL: Joi.string().required(),
                REDIS_HOST: Joi.string().required(),
                REDIS_PORT: Joi.number().required(),
                DISABLE_SYNC_REDIS: Joi.string().optional(),
            }),
        }),
        EventEmitterModule.forRoot(),
        PaymentsModule,
        GatewayModule,
        WebhookModule,
    ],
    controllers: [WebhookController],
    providers: [WebhookService],
})
export class AppModule {}
