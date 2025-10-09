import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import _request from 'request-promise-native';

@Injectable()
export class CaptchaSolverService {
    constructor(private readonly configService: ConfigService) {}

    async solveCaptcha(base64: string): Promise<string> {
        const captchaApiBaseUrl = this.configService.get<string>('CAPTCHA_API_BASE_URL');

        if (!captchaApiBaseUrl) {
            throw new Error('CAPTCHA_API_BASE_URL is not defined');
        }

        const captchaTextResolver: string = (await _request.post({
            uri: `${captchaApiBaseUrl}/resolver`,
            form: { body: base64 },
            simple: true,
        })) as string;

        if (!captchaTextResolver.includes('OK')) {
            throw new Error(`Captcha error: ${captchaTextResolver}`);
        }

        const [, captchaContent] = captchaTextResolver.split('|');
        return captchaContent;
    }
}
