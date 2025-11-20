import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { CaptchaSolverModule } from '../capcha-solver/captcha-solver.module';
import GatewayService from './gateway.service';

@Module({
    imports: [CaptchaSolverModule],
    controllers: [GatewayController],
    providers: [GatewayService],
})
export class GatewayModule {}
