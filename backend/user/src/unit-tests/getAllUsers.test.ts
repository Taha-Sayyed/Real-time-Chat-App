// src/tests/getAllUsers.test.ts
import { Response } from 'express';
import { getAllUsers } from '../controllers/user.js';
import { AuthenticatedRequest } from '../middleware/isAuth.js';
import { getUserDeps } from '../interfaces/interface_types.js';
import { IUser } from '../model/User.js';
import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";


describe('getAllUsers', () => {
    let mockUserModel: {
        find: jest.Mock<any>;
    };
    let mockReq: Partial<AuthenticatedRequest>;
    let mockRes: Response;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        mockUserModel = {
            find: jest.fn(),
        };

        jsonMock = jest.fn().mockReturnThis();
        statusMock = jest.fn().mockReturnValue({ json: jsonMock });

        mockRes = {
            status: statusMock,
            json: jsonMock,
        } as unknown as Response;

        mockReq = {
            user: {
                _id: 'user123',
                name: 'Test User',
                email: 'test@example.com',
            } as unknown as IUser,
        };
    });

    const createHandler = () =>
        getAllUsers({
            UserModel: mockUserModel as unknown as getUserDeps['UserModel'],
        });

    // Edge Case 1: Successfully returns array of users
    it('should return array of users on success', async () => {
        const mockUsers = [
            { _id: 'user1', name: 'Alice', email: 'alice@example.com' },
            { _id: 'user2', name: 'Bob', email: 'bob@example.com' },
        ];

        mockUserModel.find.mockResolvedValue(mockUsers);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.find).toHaveBeenCalledWith();
        expect(jsonMock).toHaveBeenCalledWith(mockUsers);
        expect(statusMock).not.toHaveBeenCalled();
    });

    // Edge Case 2: Empty array when no users exist
    it('should return empty array when no users exist', async () => {
        mockUserModel.find.mockResolvedValue([]);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.find).toHaveBeenCalledWith();
        expect(jsonMock).toHaveBeenCalledWith([]);
        expect(statusMock).not.toHaveBeenCalled();
    });

    // Edge Case 3: Database error via TryCatch returns 500
    it('should handle database errors via TryCatch and return 500', async () => {
        const error = new Error('Database connection failed');
        mockUserModel.find.mockRejectedValue(error);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Database connection failed',
        });
    });

    // Edge Case 4: req.user is null (auth middleware edge case)
    it('should still work when req.user is null', async () => {
        mockReq.user = null;
        const mockUsers = [{ _id: 'user1', name: 'Alice', email: 'alice@example.com' }];

        mockUserModel.find.mockResolvedValue(mockUsers);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.find).toHaveBeenCalledWith();
        expect(jsonMock).toHaveBeenCalledWith(mockUsers);
    });

    // Edge Case 5: req.user is undefined (auth middleware edge case)
    it('should still work when req.user is undefined', async () => {
        mockReq.user = undefined;
        const mockUsers = [{ _id: 'user1', name: 'Alice', email: 'alice@example.com' }];

        mockUserModel.find.mockResolvedValue(mockUsers);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.find).toHaveBeenCalledWith();
        expect(jsonMock).toHaveBeenCalledWith(mockUsers);
    });

    // Edge Case 6: Users array with Mongoose document methods
    it('should return users with Mongoose document properties', async () => {
        const mongooseUsers = [
            {
                _id: 'user1',
                name: 'Alice',
                email: 'alice@example.com',
                toObject: jest.fn().mockReturnValue({ name: 'Alice' }),
                save: jest.fn(),
            },
            {
                _id: 'user2',
                name: 'Bob',
                email: 'bob@example.com',
                toObject: jest.fn().mockReturnValue({ name: 'Bob' }),
                save: jest.fn(),
            },
        ];

        mockUserModel.find.mockResolvedValue(mongooseUsers);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.find).toHaveBeenCalledWith();
        expect(jsonMock).toHaveBeenCalledWith(mongooseUsers);
    });
});