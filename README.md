# FinTrack System

Automated system for tracking and retrieving transaction history from MB Bank. This project is forked from [payment-service](https://gitlab.com/nhayhoc/payment-service) and optimized to work exclusively with MB Bank.

## Security Warning

- This project operates by **simulating user actions** to access MB Bank's website
- Requires storing **login credentials** for your bank account
- **DO NOT** use in production environments or with accounts containing large balances
- For **educational and personal development purposes only**
- The author is **NOT responsible** for any security risks

## Features

- Automatically retrieve transaction history from MB Bank
- Cron Job support - runs automatically on schedule
- Store and manage transaction history

## System Requirements

- Node.js >= 16.x
- npm or yarn
- Chromium/Chrome browser (for headless browser automation)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/marcomoi395/fintrack-system.git
cd fintrack-system
```

### 2. Create docker-compose file

Create a `docker-compose.yml` file in the project root with the following content:

```yaml
volumes:
    redis-data:
        driver: local
services:
    app:
        build:
            context: .
            dockerfile: Dockerfile
        ports:
            - ${PORT}:${PORT}
        depends_on:
            - redis
            - captcha-resolver
        environment:
            - PORT=3000
            - APP_NAME=
            - CAPTCHA_API_BASE_URL=http://localhost:1234
            - REDIS_HOST=redis
            - REDIS_PORT=6379
            - DISABLE_SYNC_REDIS=false
            - MB_NAME=
            - MB_REPEAT_SEC=
            - MB_PASSWORD=
            - MB_LOGIN_ID=
            - MB_ACCOUNT=
            - WEBHOOK_NAME=
            - WEBHOOK_URL=
            - WEBHOOK_TOKEN=
            - WEBHOOK_CONTENT_REGEX=
            - WEBHOOK_ACCOUNT_REGEX=
    redis:
        image: redis:6.2-alpine
        volumes:
            - redis-data:/data
        ports:
            - 6379:6379
    captcha-resolver:
        image: registry.gitlab.com/nhayhoc/bank-captcha-server
        ports:
            - '1234:1234'
```

### 3.Build & run

```bash
docker-compose up -d
```
