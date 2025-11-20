import { Controller, Get } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import GatewayService from './gateway.service';
import { GATEWAY_STOP_CRON } from '../shards/events';

@Controller('gateway')
export class GatewayController {
    constructor(private readonly gateService: GatewayService) {}

    @OnEvent(GATEWAY_STOP_CRON)
    stopGateCron() {
        this.gateService.stopCron();
    }

    @Get('sync')
    triggerSync() {
        this.gateService.triggerSync();
        return {
            message: 'ok',
        };
    }
}
