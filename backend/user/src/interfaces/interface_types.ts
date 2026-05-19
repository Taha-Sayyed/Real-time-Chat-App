import { User } from "../model/User.js"
import { generateToken } from "../config/generateToken.js"

export interface RedisClient {
    get(key: string): Promise<string | null>;

    set(
        key: string,
        value: string,
        options?: {
            EX: number;
        }
    ): Promise<any>;

    del(key: string): Promise<any>;
}

export type PublishToQueue = (
    queueName: string,
    message: any
) => Promise<void>;

export interface LoginUserDependencies {
    redisClient: RedisClient;
    publishToQueue: PublishToQueue;
}

export interface VerifyUserDependencies {
    redisClient: RedisClient;
}

export type UpdateNameDeps = {
    UserModel: typeof User;
    generateToken: typeof generateToken;
};