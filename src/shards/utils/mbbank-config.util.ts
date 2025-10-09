import { Gate } from '../interfaces';
import Joi, { ValidationResult } from 'joi';
import { ConfigService } from '@nestjs/config';

export function buildMbGateFromEnv(cfg: ConfigService): Gate {
    const gateConfigSchema: Joi.ObjectSchema<Gate> = Joi.object<Gate>({
        name: Joi.string().required(),
        repeat_interval_in_sec: Joi.number().min(1).max(120).required(),
        password: Joi.string().required(),
        login_id: Joi.string().required(),
        device_id: Joi.string(),
        token: Joi.string(),
        account: Joi.string().required(),
        get_transaction_day_limit: Joi.number().min(1).max(100).default(14),
        get_transaction_count_limit: Joi.number().min(1).max(100).default(100),
    });

    const raw: Partial<Gate> = {
        name: cfg.get<string>('MB_NAME') ?? 'mbbank',
        repeat_interval_in_sec: Number(cfg.get<string>('MB_REPEAT_SEC') ?? '30'),
        password: cfg.get<string>('MB_PASSWORD') ?? '',
        login_id: cfg.get<string>('MB_LOGIN_ID') ?? '',
        account: cfg.get<string>('MB_ACCOUNT') ?? '',
        get_transaction_day_limit: cfg.get<number>('MB_TXN_DAY_LIMIT') ?? 14,
        get_transaction_count_limit: cfg.get<number>('MB_TXN_COUNT_LIMIT') ?? 100,
    };

    const result: ValidationResult<Gate> = gateConfigSchema.validate(raw, {
        abortEarly: false,
        stripUnknown: true,
    });

    if (result.error) {
        throw new Error(`Invalid: ${result.error.message} on ${raw.name}`);
    }

    return result.value;
}
