import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Gate, MbBankTransactionDto, Payment } from '../shards/interfaces';
import {
    GATEWAY_CRON_ERROR_STREAK,
    GATEWAY_CRON_RECOVERY,
    PAYMENT_HISTORY_UPDATED,
} from '../shards/events';
import { sleep } from '../shards/helpers/sleep';
import { CaptchaSolverService } from '../capcha-solver/captcha-solver.service';
import cron from 'node-cron';
import { ConfigService } from '@nestjs/config';
import { buildMbGateFromEnv } from '../shards/utils/mbbank-config.util';
import moment from 'moment-timezone';
import { axios } from '../shards/helpers/axios';
import * as playwright from 'playwright';
import { AxiosResponse } from 'axios';

@Injectable()
class GatewayService {
    private logger = new Logger(GatewayService.name);
    private isCronRunning = false;
    private errorStreak = 0;
    private numberOfRetries = 0;
    private isErrored = false;
    private cronTimer?: NodeJS.Timeout;
    private cooldownTimer?: NodeJS.Timeout;
    private sessionId: string | null | undefined;
    private deviceId: string = '';
    private config: Gate;

    constructor(
        readonly eventEmitter: EventEmitter2,
        readonly captchaSolver: CaptchaSolverService,
        readonly cfg: ConfigService,
    ) {
        this.config = buildMbGateFromEnv(cfg);
    }

    onApplicationBootstrap() {
        cron.schedule(
            '00 19 * * *',
            () => {
                this.triggerSync();
            },
            {
                timezone: 'Asia/Ho_Chi_Minh',
            },
        );
    }

    private getName() {
        return this.config.name;
    }

    private async login(): Promise<void> {
        let browser: playwright.Browser | null = null;

        try {
            browser = await playwright.chromium.launch({
                headless: false,
            });

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
                    } catch {
                        return route.abort();
                    }
                }
                await route.continue();
            });

            const getCaptchaWaitResponse = page.waitForResponse(
                '**/retail-internetbankingms/getCaptchaImage',
                { timeout: 60000 },
            );

            await page.goto('https://online.mbbank.com.vn/pl/login');

            const getCaptchaJson: { imageString: string } = (await getCaptchaWaitResponse.then(
                (d) => d.json(),
            )) as { imageString: string };

            if (!getCaptchaJson.imageString) {
                throw new Error('Không lấy được mã captcha!');
            }
            const captchaText = await this.captchaSolver.solveCaptcha(getCaptchaJson.imageString);

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

            const loginJson: any = await loginWaitResponse.then((d) => d.json());

            if (loginJson.result.responseCode === 'GW283') {
                throw new Error('Wrong captcha');
            }

            if (!loginJson.result.ok) {
                throw new Error('Login failed');
            }

            this.sessionId = loginJson.sessionId;
            this.deviceId = loginJson.cust.deviceId;
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(String(error));
        } finally {
            await browser?.close();
        }
    }

    private async getHistory(): Promise<Payment[]> {
        try {
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
                'User-Agent':
                    'Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0',
                Accept: 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                Authorization: 'Basic RU1CUkVUQUlMV0VCOlNEMjM0ZGZnMzQlI0BGR0AzNHNmc2RmNDU4NDNm',
                App: 'MB_WEB',
                Refno: '03',
                'Content-Type': 'application/json; charset=utf-8',
                Deviceid: 'z2uax13k-mbib-0000-0000-2025040909112465',
                'X-Request-Id': '0',
                'Elastic-Apm-Traceparent':
                    '00-3b64d8bfc56824dd41f667d2ddc32621-7e050c8cc389a153-01',
                Origin: 'https://online.mbbank.com.vn',
                Referer: 'https://online.mbbank.com.vn/information-account/source-account',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                Priority: 'u=0',
                Te: 'trailers',
            };

            const { data } = await axios.post<MbBankTransactionDto>(
                'https://online.mbbank.com.vn/api/retail-transactionms/transactionms/get-account-transaction-history',
                dataSend,
                { headers },
            );

            if (data.result.responseCode === 'GW200') {
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
            if (
                error.message.includes(
                    'Client network socket disconnected before secure TLS connection was established',
                )
            ) {
                await sleep(10000);
            }

            if (error instanceof Error) {
                throw error;
            }
            throw new Error(String(error));
        }
    }

    private safeErrorMessage(err: unknown): string {
        if (err instanceof Error) {
            return err.message;
        }
        if (typeof err === 'string') {
            return err;
        }
        try {
            return JSON.stringify(err);
        } catch {
            return String(err);
        }
    }

    private scheduleNext(runAfterMs: number) {
        if (!this.isCronRunning) {
            return;
        }
        clearTimeout(this.cronTimer);
        this.cronTimer = setTimeout(() => void this.executeOnce(), runAfterMs);
    }

    private handleError(err: unknown) {
        const msg = this.safeErrorMessage(err);

        this.logger.error(
            `[${this.getName()}] ${msg}`,
            err instanceof Error ? err.stack : undefined,
        );

        this.errorStreak += 1;

        if (this.numberOfRetries === 3) {
            this.isCronRunning = false;
            this.stopCron();
            return;
        }

        if (this.errorStreak > 5) {
            if (!this.isErrored) {
                this.isErrored = true;
            }

            this.eventEmitter.emit(GATEWAY_CRON_ERROR_STREAK, {
                name: this.getName(),
                error: msg,
            });

            // Cooldown 5 min and retry
            clearTimeout(this.cooldownTimer);
            this.cooldownTimer = setTimeout(
                () => {
                    if (!this.isCronRunning) {
                        return;
                    }
                    this.errorStreak = 0;
                    this.numberOfRetries += 1;
                    this.scheduleNext(0);
                },
                5 * 60 * 1000,
            );
        } else {
            // retry nhanh 5s
            this.scheduleNext(5 * 1000);
        }
    }

    // Execute once for manual trigger
    private async executeOnce() {
        try {
            const payments = await this.getHistory();
            this.eventEmitter.emit(PAYMENT_HISTORY_UPDATED, payments);

            if (this.isErrored) {
                this.eventEmitter.emit(GATEWAY_CRON_RECOVERY, { name: this.getName() });
            }

            this.stopCron();
        } catch (err) {
            this.handleError(err);
        }
    }

    stopCron() {
        this.isErrored = false;
        this.isCronRunning = false;
        this.numberOfRetries = 0;
        this.errorStreak = 0;
        clearTimeout(this.cronTimer);
        clearTimeout(this.cooldownTimer);
        this.logger.log(`[${this.getName()}] cron stopped`);
    }

    triggerSync() {
        if (this.isCronRunning) {
            this.logger.warn(`[${this.getName()}] cron is running, cannot trigger sync`);
            return;
        }

        this.isCronRunning = true;
        try {
            this.scheduleNext(0);
            return { ok: true };
        } catch (err) {
            const msg = this.safeErrorMessage(err);
            this.logger.error(`[${this.getName()}] manual sync failed: ${msg}`);
            throw err;
        }
    }
}

export default GatewayService;
