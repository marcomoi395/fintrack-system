import { Webhook } from '../interfaces';
import Joi, { ValidationResult } from 'joi';
import { ConfigService } from '@nestjs/config';

export function webhookConfig(cfg: ConfigService): Webhook {
    const gateConfigSchema: Joi.ObjectSchema<Webhook> = Joi.object<Webhook>({
        url: Joi.string().uri({ allowRelative: false }).trim().required(),
        token: Joi.string().trim().allow('').default(''),
        conditions: {
            content_regex: Joi.string().trim().allow('').default(''),
            account_regex: Joi.string().trim().allow('').default(''),
        },
    });

    const raw: Partial<Webhook> = {
        url: cfg.get<string>('WEBHOOK_URL') ?? '',
        token: cfg.get<string>('WEBHOOK_TOKEN') ?? '',
        conditions: {
            content_regex: cfg.get<string>('WEBHOOK_CONTENT_REGEX') ?? '',
            account_regex: cfg.get<string>('WEBHOOK_ACCOUNT_REGEX') ?? '',
        },
    };

    // Validate và strip unknown
    const result: ValidationResult<Webhook> = gateConfigSchema.validate(raw, {
        abortEarly: false,
        stripUnknown: true,
    });

    if (result.error) {
        throw new Error(`Invalid webhook config: ${result.error.message}`);
    }

    return result.value;
}
