import { Module } from '@nestjs/common';
import { PaymentsModule } from './payments/payments.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        PaymentsModule,
    ],
})
export class AppModule {
    constructor(private readonly configService: ConfigService) {}
}
