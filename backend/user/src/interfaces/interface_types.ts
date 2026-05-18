export interface RedisClient {
    get(key: string): Promise<string | null>;

    set(
        key: string,
        value: string,
        options?: {
            EX: number;
        }
    ): Promise<any>;
}

export type PublishToQueue = (
    queueName: string,
    message: any
) => Promise<void>;

export interface LoginUserDependencies {
    redisClient: RedisClient;
    publishToQueue: PublishToQueue;
}