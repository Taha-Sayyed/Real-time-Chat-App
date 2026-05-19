// src/tests/updateName.test.ts
import { Response } from 'express';
import { updateName } from '../controllers/user.js';
import { AuthenticatedRequest } from '../middleware/isAuth.js';
import { UpdateNameDeps } from '../interfaces/interface_types.js';
import { IUser } from '../model/User.js';
import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";

describe('updateName', () => {
    let mockUserModel: {
        findById: jest.MockedFunction<any>;
    };
    let mockGenerateToken: jest.MockedFunction<(user: any) => string>;
    let mockReq: Partial<AuthenticatedRequest>;
    let mockRes: Response;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        mockUserModel = {
            findById: jest.fn(),
        };

        mockGenerateToken = jest.fn<(user: any) => string>().mockReturnValue('mock-jwt-token');

        jsonMock = jest.fn().mockReturnThis();
        statusMock = jest.fn().mockReturnValue({ json: jsonMock });

        mockRes = {
            status: statusMock,
            json: jsonMock,
        } as unknown as Response;

        mockReq = {
            user: {
                _id: 'user123',
                name: 'Old Name',
                email: 'test@example.com',
            } as unknown as IUser,
            body: {
                name: 'New Name',
            },
        };
    });

    const createHandler = () =>
        updateName({
            UserModel: mockUserModel as unknown as UpdateNameDeps['UserModel'],
            generateToken: mockGenerateToken,
        });

    // Edge Case 1: Successful name update for existing user
    it('should update name, save user, generate token and return updated user', async () => {
        const mockUser = {
            _id: 'user123',
            name: 'Old Name',
            email: 'test@example.com',
            save: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };

        mockUserModel.findById.mockResolvedValue(mockUser);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.findById).toHaveBeenCalledWith('user123');
        expect(mockUser.name).toBe('New Name');
        expect(mockUser.save).toHaveBeenCalled();
        expect(mockGenerateToken).toHaveBeenCalledWith(mockUser);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'User Updated',
            user: mockUser,
            token: 'mock-jwt-token',
        });
        expect(statusMock).not.toHaveBeenCalled();
    });

    // Edge Case 2: User not found (invalid/expired session)
    it('should return 404 when user is not found', async () => {
        mockUserModel.findById.mockResolvedValue(null);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.findById).toHaveBeenCalledWith('user123');
        expect(statusMock).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Please login',
        });
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });

    // Edge Case 3: req.user is null (no authenticated user)
    it('should handle null req.user and return 404', async () => {
        mockReq.user = null;
        mockUserModel.findById.mockResolvedValue(null);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.findById).toHaveBeenCalledWith(undefined);
        expect(statusMock).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Please login',
        });
    });

    // Edge Case 4: req.user is undefined (no authenticated user)
    it('should handle undefined req.user and return 404', async () => {
        mockReq.user = undefined;
        mockUserModel.findById.mockResolvedValue(null);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUserModel.findById).toHaveBeenCalledWith(undefined);
        expect(statusMock).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Please login',
        });
    });

    // Edge Case 5: Database error during findById via TryCatch
    it('should handle database errors via TryCatch and return 500', async () => {
        const error = new Error('Database connection failed');
        mockUserModel.findById.mockRejectedValue(error);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Database connection failed',
        });
    });

    // Edge Case 6: Error during user.save() via TryCatch
    it('should handle save errors via TryCatch and return 500', async () => {
        const mockUser = {
            _id: 'user123',
            name: 'Old Name',
            email: 'test@example.com',
            save: jest.fn<() => Promise<void>>().mockRejectedValue(new Error('Save failed')),
        };

        mockUserModel.findById.mockResolvedValue(mockUser);

        const handler = createHandler();
        await handler(mockReq as AuthenticatedRequest, mockRes, jest.fn());

        expect(mockUser.name).toBe('New Name');
        expect(mockUser.save).toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Save failed',
        });
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });
});