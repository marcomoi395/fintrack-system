import Redis, { RedisOptions } from 'ioredis';

export default () => {
    const redisSetting: RedisOptions = {
        port: Number(process.env.REDIS_PORT),
        host: process.env.REDIS_HOST || 'localhost',
        db: 0,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    };

    const redis = new Redis(redisSetting);
    return {
        redis,
    };
};
