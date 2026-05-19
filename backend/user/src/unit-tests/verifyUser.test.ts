// src/tests/verifyUser.test.ts
import { describe, it, expect, jest, beforeEach, afterEach ,afterAll} from "@jest/globals";

import { Request, Response } from 'express';
import { verifyUser } from '../controllers/user.js';
import { RedisClient, VerifyUserDependencies } from '../interfaces/interface_types.js';

describe('verifyUser', () => {
  let mockRedisClient: jest.Mocked<RedisClient>;
  let mockGenerateToken: jest.MockedFunction<(user: any) => string>;
  let mockUserModel: any;
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

    mockGenerateToken = jest.fn<(user: any) => string>().mockReturnValue('mock-jwt-token');

    mockUserModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };

    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRes = {
      status: statusMock,
      json: jsonMock,
    } as unknown as Response;

    mockReq = {
      body: {
        email: 'test@example.com',
        otp: '123456',
      },
    };
  });

  const createHandler = () =>
    verifyUser({
      redisClient: mockRedisClient,
      generateToken: mockGenerateToken,
      UserModel: mockUserModel,
    });

  // Edge Case 1: Missing email or OTP
  it('should return 400 when email or OTP is missing', async () => {
    mockReq.body = { email: 'test@example.com' };

    const handler = createHandler();
    await handler(mockReq as Request, mockRes, jest.fn());

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'Email and OTP Required',
    });
    expect(mockRedisClient.get).not.toHaveBeenCalled();
  });

  // Edge Case 2: Invalid or expired OTP
  it('should return 400 when OTP is invalid or expired', async () => {
    mockRedisClient.get.mockResolvedValue(null);

    const handler = createHandler();
    await handler(mockReq as Request, mockRes, jest.fn());

    expect(mockRedisClient.get).toHaveBeenCalledWith('otp:test@example.com');
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'Invalid or expired OTP',
    });
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  // Edge Case 3: OTP mismatch
  it('should return 400 when entered OTP does not match stored OTP', async () => {
    mockRedisClient.get.mockResolvedValue('999999');

    const handler = createHandler();
    await handler(mockReq as Request, mockRes, jest.fn());

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'Invalid or expired OTP',
    });
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  // Edge Case 4: Existing user - successful verification
  it('should verify existing user, delete OTP, generate token and return user data', async () => {
    const existingUser = {
      _id: 'user123',
      name: 'John Doe',
      email: 'test@example.com',
    };
    mockRedisClient.get.mockResolvedValue('123456');
    mockUserModel.findOne.mockResolvedValue(existingUser);

    const handler = createHandler();
    await handler(mockReq as Request, mockRes, jest.fn());

    expect(mockRedisClient.del).toHaveBeenCalledWith('otp:test@example.com');
    expect(mockUserModel.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
    expect(mockUserModel.create).not.toHaveBeenCalled();
    expect(mockGenerateToken).toHaveBeenCalledWith(existingUser);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'User Verified',
      user: existingUser,
      token: 'mock-jwt-token',
    });
    expect(statusMock).not.toHaveBeenCalled();
  });

  // Edge Case 5: New user - create user, generate token and return user data
  it('should create new user when user does not exist, generate token and return user data', async () => {
    const newUser = {
      _id: 'newuser456',
      name: 'test@ex',
      email: 'test@example.com',
    };
    mockRedisClient.get.mockResolvedValue('123456');
    mockUserModel.findOne.mockResolvedValue(null);
    mockUserModel.create.mockResolvedValue(newUser);

    const handler = createHandler();
    await handler(mockReq as Request, mockRes, jest.fn());

    expect(mockRedisClient.del).toHaveBeenCalledWith('otp:test@example.com');
    expect(mockUserModel.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
    expect(mockUserModel.create).toHaveBeenCalledWith({
      name: 'test@ex',
      email: 'test@example.com',
    });
    expect(mockGenerateToken).toHaveBeenCalledWith(newUser);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'User Verified',
      user: newUser,
      token: 'mock-jwt-token',
    });
  });

  // Edge Case 6: Server error handling via TryCatch
  it('should handle Redis errors via TryCatch and return 500', async () => {
    const error = new Error('Redis connection failed');
    mockRedisClient.get.mockRejectedValue(error);

    const handler = createHandler();
    await handler(mockReq as Request, mockRes, jest.fn());

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'Redis connection failed',
    });
  });
});