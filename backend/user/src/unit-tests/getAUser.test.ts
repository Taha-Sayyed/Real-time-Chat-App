// src/tests/getAUser.test.ts
import { Request, Response } from 'express';
import { getAUser } from '../controllers/user.js';
import { getUserDeps } from '../interfaces/interface_types.js';
import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";


describe('getAUser', () => {
    let mockUserModel: {
        findById: jest.MockedFunction<any>;
    };
    let mockReq: Partial<Request>;
    let mockRes: Response;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        mockUserModel = {
            findById: jest.fn(),
        };

        jsonMock = jest.fn().mockReturnThis();
        statusMock = jest.fn().mockReturnValue({ json: jsonMock });

        mockRes = {
            status: statusMock,
            json: jsonMock,
        } as unknown as Response;

        mockReq = {
            params: {
                id: 'user123',
            },
        };
    });

    const createHandler = () =>
        getAUser({
            UserModel: mockUserModel as unknown as getUserDeps['UserModel'],
        });

    // Edge Case 1: Successfully returns a user by ID
    it('should return user when found by ID', async () => {
        const mockUser = {
            _id: 'user123',
            name: 'Alice',
            email: 'alice@example.com',
        };

        mockUserModel.findById.mockResolvedValue(mockUser);

        const handler = createHandler();
        await handler(mockReq as Request, mockRes, jest.fn());

        expect(mockUserModel.findById).toHaveBeenCalledWith('user123');
        expect(jsonMock).toHaveBeenCalledWith(mockUser);
        expect(statusMock).not.toHaveBeenCalled();
    });

    // Edge Case 2: User not found (null response)
    it('should return null when user is not found', async () => {
        mockUserModel.findById.mockResolvedValue(null);

        const handler = createHandler();
        await handler(mockReq as Request, mockRes, jest.fn());

        expect(mockUserModel.findById).toHaveBeenCalledWith('user123');
        expect(jsonMock).toHaveBeenCalledWith(null);
        expect(statusMock).not.toHaveBeenCalled();
    });

    // Edge Case 3: Database error via TryCatch returns 500
    it('should handle database errors via TryCatch and return 500', async () => {
        const error = new Error('Database connection failed');
        mockUserModel.findById.mockRejectedValue(error);

        const handler = createHandler();
        await handler(mockReq as Request, mockRes, jest.fn());

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Database connection failed',
        });
    });

    // Edge Case 4: Invalid ObjectId format
    it('should handle invalid ID format and return 500', async () => {
        const error = new Error('Cast to ObjectId failed');
        mockUserModel.findById.mockRejectedValue(error);

        const handler = createHandler();
        await handler(mockReq as Request, mockRes, jest.fn());

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Cast to ObjectId failed',
        });
    });

    // Edge Case 5: Missing id parameter
    it('should handle missing id parameter', async () => {
        mockReq.params = {};
        mockUserModel.findById.mockResolvedValue(null);

        const handler = createHandler();
        await handler(mockReq as Request, mockRes, jest.fn());

        expect(mockUserModel.findById).toHaveBeenCalledWith(undefined);
        expect(jsonMock).toHaveBeenCalledWith(null);
    });

    // Edge Case 6: User with Mongoose document methods
    it('should return user with Mongoose document properties', async () => {
        const mongooseUser = {
            _id: 'user123',
            name: 'Alice',
            email: 'alice@example.com',
            toObject: jest.fn().mockReturnValue({ name: 'Alice' }),
            save: jest.fn(),
        };

        mockUserModel.findById.mockResolvedValue(mongooseUser);

        const handler = createHandler();
        await handler(mockReq as Request, mockRes, jest.fn());

        expect(mockUserModel.findById).toHaveBeenCalledWith('user123');
        expect(jsonMock).toHaveBeenCalledWith(mongooseUser);
    });
});