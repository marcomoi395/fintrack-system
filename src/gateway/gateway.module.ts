import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import MBBankService from './mbbank.services';
import { CaptchaSolverModule } from '../capcha-solver/captcha-solver.module';
import GatewayService from './gateway.service';

@Module({
    imports: [CaptchaSolverModule],
    controllers: [GatewayController],
    providers: [MBBankService, { provide: GatewayService, useExisting: MBBankService }],
})
export class GatewayModule {}
