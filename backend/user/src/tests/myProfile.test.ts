// src/tests/myProfile.test.ts
import { Response } from 'express';
import { myProfile } from '../controllers/user.js';
import { AuthenticatedRequest } from '../middleware/isAuth.js';
import { IUser } from '../model/User.js';
import { describe, it, expect, jest, beforeEach, afterEach ,afterAll} from "@jest/globals";


describe('myProfile', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Response;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRes = {
      status: statusMock,
      json: jsonMock,
    } as unknown as Response;
  });

  const createHandler = () => myProfile;

  // Edge Case 1: User exists with all fields
  it('should return user object when req.user is populated', async () => {
    const mockUser = {
      _id: 'user123',
      name: 'John Doe',
      email: 'john@example.com',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    } as unknown as IUser;

    mockReq = {
      user: mockUser,
    };

    const handler = createHandler();
    await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

    expect(jsonMock).toHaveBeenCalledWith(mockUser);
    expect(statusMock).not.toHaveBeenCalled();
  });

  // Edge Case 2: User is null (edge case in auth middleware)
  it('should return null when req.user is null', async () => {
    mockReq = {
      user: null,
    };

    const handler = createHandler();
    await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

    expect(jsonMock).toHaveBeenCalledWith(null);
    expect(statusMock).not.toHaveBeenCalled();
  });

  // Edge Case 3: User is undefined (edge case in auth middleware)
  it('should return undefined when req.user is undefined', async () => {
    mockReq = {
      user: undefined,
    };

    const handler = createHandler();
    await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

    expect(jsonMock).toHaveBeenCalledWith(undefined);
    expect(statusMock).not.toHaveBeenCalled();
  });

  // Edge Case 4: User has minimal fields (newly created user)
  it('should return user with minimal fields', async () => {
    const minimalUser = {
      _id: 'newuser456',
      name: 'test@ex',
      email: 'test@example.com',
    } as unknown as IUser;

    mockReq = {
      user: minimalUser,
    };

    const handler = createHandler();
    await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

    expect(jsonMock).toHaveBeenCalledWith(minimalUser);
  });

  // Edge Case 5: User object with Mongoose Document methods (simulating real DB doc)
  it('should return user with Mongoose document properties', async () => {
    const mongooseUser = {
      _id: 'user789',
      name: 'Jane Smith',
      email: 'jane@example.com',
      toObject: jest.fn().mockReturnValue({ name: 'Jane Smith' }),
      save: jest.fn(),
    } as unknown as IUser;

    mockReq = {
      user: mongooseUser,
    };

    const handler = createHandler();
    await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

    expect(jsonMock).toHaveBeenCalledWith(mongooseUser);
  });

  // Edge Case 6: Unexpected error via TryCatch wrapper
  it('should handle unexpected errors via TryCatch and return 500', async () => {
    mockReq = {
      get user() {
        throw new Error('Property access failed');
      },
    } as Partial<AuthenticatedRequest>;

    const handler = createHandler();
    await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      message: 'Property access failed',
    });
  });
});