import { axios } from 'src/shards/helpers/axios';
import moment from 'moment-timezone';
import { Injectable } from '@nestjs/common';
import * as playwright from 'playwright';
import type { Gate, MbBankTransactionDto, Payment } from '../shards/interfaces';
import GatewayService from './gateway.service';
import { sleep } from 'src/shards/helpers/sleep';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CaptchaSolverService } from '../capcha-solver/captcha-solver.service';
import { buildMbGateFromEnv } from '../shards/utils/mbbank-config.util';
import { AxiosResponse } from 'axios';

@Injectable()
class MBBankService extends GatewayService {
    private sessionId: string | null | undefined;
    private deviceId: string = '';

    constructor(
        cfg: ConfigService,
        eventEmitter: EventEmitter2,
        captchaSolver: CaptchaSolverService,
    ) {
        const gateConfig: Gate = buildMbGateFromEnv(cfg);
        super(gateConfig, eventEmitter, captchaSolver);
    }

    private async login() {
        const browser = await playwright.chromium.launch({
            headless: false,
        });

        try {
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
                viewport: { width: 1366, height: 768 },
                locale: 'vi-VN',
                timezoneId: 'Asia/Ho_Chi_Minh',
                permissions: ['geolocation'],
                geolocation: { latitude: 10.762622, longitude: 106.660172 }, // Hồ Chí Minh
                colorScheme: 'light',
            });
            const page = await context.newPage();

            // Tiết kiệm băng thông
            await page.route('**/*', async (route) => {
                const url = route.request().url();
                const resourceType = route.request().resourceType();

                if (url.includes('/api/retail-web-internetbankingms/getCaptchaImage')) {
                    return route.continue();
                }

                if (['image', 'media'].includes(resourceType)) {
                    return route.abort();
                }

                if (![`xhr`, `fetch`, `document`].includes(resourceType)) {
                    try {
                        const response: AxiosResponse<ArrayBuffer> = await axios.get(url, {
                            responseType: 'arraybuffer',
                        });
                        return route.fulfill({
                            status: response.status,
                            headers: response.headers as Record<string, string>,
                            body: Buffer.from(response.data),
                        });
                    } catch (error) {
                        return route.abort();
                    }
                }
                await route.continue();
            });

            await page.goto('https://online.mbbank.com.vn/pl/login');
            await page.waitForSelector('img.ng-star-inserted', {
                state: 'visible',
                timeout: 10000,
            });

            const captchaImg = page.locator('img.ng-star-inserted');
            const captchaSrc = await captchaImg.getAttribute('src');
            const base64Data = captchaSrc?.replace(/^data:image\/png;base64,/, '');

            if (!base64Data) {
                throw new Error('Không lấy được mã captcha!');
            }

            const captchaText = await this.captchaSolver.solveCaptcha(base64Data);

            await page.locator('#form1').getByRole('img').click();
            await page.getByPlaceholder('Tên đăng nhập').click();
            await page.getByPlaceholder('Tên đăng nhập').fill(String(this.config.login_id));
            await page.getByPlaceholder('Tên đăng nhập').press('Tab');
            await page.getByPlaceholder('Nhập mật khẩu').fill(String(this.config.password));
            await page.getByPlaceholder('NHẬP MÃ KIỂM TRA').click();
            await page.getByPlaceholder('NHẬP MÃ KIỂM TRA').fill(captchaText);

            const loginWaitResponse = page.waitForResponse(new RegExp('.*doLogin$', 'g'));
            await sleep(1000);
            await page.getByRole('button', { name: 'Đăng nhập' }).click();

            const loginJson: unknown = await loginWaitResponse.then((d) => d.json());

            if (!MBBankService.isLoginResponse(loginJson)) {
                throw new Error('Unexpected login response shape');
            }

            if (loginJson.result.responseCode === 'GW283') {
                throw new Error('Wrong captcha');
            }

            if (!loginJson.result.ok) {
                throw new Error('Login failed');
            }

            this.sessionId = loginJson.sessionId;
            this.deviceId = loginJson.cust.deviceId;
            await browser.close();
        } catch (error) {
            await browser.close();
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(String(error)); // ép về Error an toàn
        }
    }

    private static isLoginResponse(x: unknown): x is {
        sessionId: string;
        cust: { deviceId: string };
        result: {
            responseCode: string;
            ok: boolean;
            message?: { message?: string } | string;
        };
    } {
        if (typeof x !== 'object' || x === null) {
            return false;
        }
        const obj = x as Record<string, unknown>;
        const result = obj.result as Record<string, unknown> | undefined;
        const cust = obj.cust as Record<string, unknown> | undefined;
        return (
            typeof obj.sessionId === 'string' &&
            !!cust &&
            typeof cust.deviceId === 'string' &&
            !!result &&
            typeof result.responseCode === 'string' &&
            typeof result.ok === 'boolean'
        );
    }

    async getHistory(): Promise<Payment[]> {
        if (!this.sessionId) {
            await this.login();
        }

        const fromDate = moment()
            .tz('Asia/Ho_Chi_Minh')
            .subtract(this.config.get_transaction_day_limit, 'days')
            .format('DD/MM/YYYY');
        const toDate = moment().tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY');
        const refNo =
            this.config.account.toUpperCase() +
            '-' +
            moment().tz('Asia/Ho_Chi_Minh').format('YYYYMMDDHHmmssSS');

        const dataSend = {
            accountNo: this.config.account,
            fromDate,
            toDate,
            sessionId: this.sessionId,
            refNo,
            deviceIdCommon: this.deviceId,
        };

        const headers = {
            Host: 'online.mbbank.com.vn',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0',
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            Authorization: 'Basic RU1CUkVUQUlMV0VCOlNEMjM0ZGZnMzQlI0BGR0AzNHNmc2RmNDU4NDNm',
            App: 'MB_WEB',
            Refno: '03',
            'Content-Type': 'application/json; charset=utf-8',
            Deviceid: 'z2uax13k-mbib-0000-0000-2025040909112465',
            'X-Request-Id': '0',
            'Elastic-Apm-Traceparent': '00-3b64d8bfc56824dd41f667d2ddc32621-7e050c8cc389a153-01',
            Origin: 'https://online.mbbank.com.vn',
            Referer: 'https://online.mbbank.com.vn/information-account/source-account',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            Priority: 'u=0',
            Te: 'trailers',
        };

        try {
            const { data } = await axios.post<MbBankTransactionDto>(
                'https://online.mbbank.com.vn/api/retail-transactionms/transactionms/get-account-transaction-history',
                dataSend,
                { headers },
            );

            if (data.result.responseCode === 'GW200') {
                console.warn('Session expired, re-login...');
                this.sessionId = null;
                await this.login();
                return this.getHistory();
            }

            if (!data.result.ok) {
                throw new Error(data.result.message);
            }

            if (!data.transactionHistoryList || data.transactionHistoryList.length < 1) {
                return [];
            }

            return data.transactionHistoryList.map((transaction) => ({
                transaction_id: 'mbbank-' + transaction.refNo,
                credit_amount: Number(transaction.creditAmount),
                debit_amount: Number(transaction.debitAmount),
                content: transaction.description,
                date: moment
                    .tz(transaction.transactionDate, 'DD/MM/YYYY HH:mm:ss', 'Asia/Ho_Chi_Minh')
                    .toDate(),
                account_receiver:
                    Number(transaction.debitAmount) > 0
                        ? transaction.benAccountNo
                        : transaction.accountNo,
                account_sender:
                    Number(transaction.creditAmount) > 0
                        ? transaction.benAccountNo
                        : transaction.accountNo,
                name_sender: transaction.benAccountName,
            }));
        } catch (error) {
            console.error(error);
            try {
                if (
                    error.message.includes(
                        'Client network socket disconnected before secure TLS connection was established',
                    )
                ) {
                    await sleep(10000);
                } else {
                    await this.login();
                }
            } catch (error) {
                console.error(error);
            }

            throw error;
        }
    }
}

export default MBBankService;
