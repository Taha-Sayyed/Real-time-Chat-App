import { describe, it, expect, jest, beforeEach, afterEach ,afterAll} from "@jest/globals";
// src/__tests__/loginUser.test.ts
// src/tests/loginUser.test.ts
import { Request, Response } from 'express';
import { loginUser } from '../controllers/user.js';
import { RedisClient, PublishToQueue } from '../interfaces/interface_types.js';

const mockMathRandom = jest.spyOn(Math, 'random');

describe('loginUser', () => {
  let mockRedisClient: jest.Mocked<RedisClient>;
  let mockPublishToQueue: jest.MockedFunction<PublishToQueue>;
  let mockReq: Partial<Request>;
  let mockRes: Response;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<RedisClient>;

    mockPublishToQueue = jest.fn();

    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    // Cast to unknown first, then to Response to satisfy TypeScript
    mockRes = {
      status: statusMock,
      json: jsonMock,
    } as unknown as Response;

    mockReq = {
      body: {
        email: 'test@example.com',
      },
    };

    mockMathRandom.mockReturnValue(0.5);
  });

  afterAll(() => {
    mockMathRandom.mockRestore();
  });

  it('should return 429 if rate limit exists', async () => {
    mockRedisClient.get.mockResolvedValue('true');

    const handler = loginUser({
      redisClient: mockRedisClient,
      publishToQueue: mockPublishToQueue,
    });

    await handler(mockReq as Request, mockRes, jest.fn());

    expect(mockRedisClient.get).toHaveBeenCalledWith('otp:ratelimit:test@example.com');
    expect(statusMock).toHaveBeenCalledWith(429);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'Too may requests. Please wait before requesting new otp',
    });
    expect(mockRedisClient.set).not.toHaveBeenCalled();
    expect(mockPublishToQueue).not.toHaveBeenCalled();
  });

  it('should generate OTP, store in Redis, set rate limit, and publish to queue', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.set.mockResolvedValue('OK');

    const handler = loginUser({
      redisClient: mockRedisClient,
      publishToQueue: mockPublishToQueue,
    });

    await handler(mockReq as Request, mockRes, jest.fn());

    expect(mockRedisClient.get).toHaveBeenCalledWith('otp:ratelimit:test@example.com');
    expect(mockRedisClient.set).toHaveBeenCalledWith('otp:test@example.com', '550000', {
      EX: 300,
    });
    expect(mockRedisClient.set).toHaveBeenCalledWith('otp:ratelimit:test@example.com', 'true', {
      EX: 60,
    });
    expect(mockPublishToQueue).toHaveBeenCalledWith('send-otp', {
      to: 'test@example.com',
      subject: 'Your otp code',
      body: 'Your OTP is 550000. It is valid for 5 minutes',
    });
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'OTP sent to your mail',
    });
  });

  it('should generate different OTPs based on Math.random', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.set.mockResolvedValue('OK');
    mockMathRandom.mockReturnValue(0.123);

    const handler = loginUser({
      redisClient: mockRedisClient,
      publishToQueue: mockPublishToQueue,
    });

    await handler(mockReq as Request, mockRes, jest.fn());

    expect(mockRedisClient.set).toHaveBeenCalledWith(
      'otp:test@example.com',
      '210700',
      { EX: 300 }
    );
    expect(mockPublishToQueue).toHaveBeenCalledWith('send-otp', {
      to: 'test@example.com',
      subject: 'Your otp code',
      body: 'Your OTP is 210700. It is valid for 5 minutes',
    });
  });

  it('should handle errors via TryCatch and return 500', async () => {
    const error = new Error('Redis connection failed');
    mockRedisClient.get.mockRejectedValue(error);

    const handler = loginUser({
      redisClient: mockRedisClient,
      publishToQueue: mockPublishToQueue,
    });

    await handler(mockReq as Request, mockRes, jest.fn());

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'Redis connection failed',
    });
  });

  it('should handle publishToQueue errors via TryCatch', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.set.mockResolvedValue('OK');
    const error = new Error('Queue connection failed');
    mockPublishToQueue.mockRejectedValue(error);

    const handler = loginUser({
      redisClient: mockRedisClient,
      publishToQueue: mockPublishToQueue,
    });

    await handler(mockReq as Request, mockRes, jest.fn());

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'Queue connection failed',
    });
  });

  it('should handle different email addresses correctly', async () => {
    mockReq.body.email = 'user2@domain.org';
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.set.mockResolvedValue('OK');

    const handler = loginUser({
      redisClient: mockRedisClient,
      publishToQueue: mockPublishToQueue,
    });

    await handler(mockReq as Request, mockRes, jest.fn());

    expect(mockRedisClient.get).toHaveBeenCalledWith('otp:ratelimit:user2@domain.org');
    expect(mockRedisClient.set).toHaveBeenCalledWith('otp:user2@domain.org', '550000', {
      EX: 300,
    });
    expect(mockPublishToQueue).toHaveBeenCalledWith('send-otp', {
      to: 'user2@domain.org',
      subject: 'Your otp code',
      body: 'Your OTP is 550000. It is valid for 5 minutes',
    });
  });
});