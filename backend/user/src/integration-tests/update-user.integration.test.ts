import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { describe, it, expect, jest, beforeEach, afterEach, afterAll, beforeAll } from "@jest/globals";


// ── 1. Mock ESM modules with plain jest.fn() factories ──
jest.unstable_mockModule("../model/User.js", () => ({
    User: {
        findById: jest.fn(),
    },
}));

jest.unstable_mockModule("../config/generateToken.js", () => ({
    generateToken: jest.fn(),
}));

// ── 2. Dynamic imports ──
const { default: userRoutes } = await import("../routes/user.js");
const { generateToken } = await import("../config/generateToken.js");
const { User } = await import("../model/User.js");

describe("POST /api/v1/update/user", () => {
    let app: express.Express;
    const JWT_SECRET = "test-secret-key-for-jwt";

    beforeAll(() => {
        process.env.JWT_SECRET = JWT_SECRET;
    });

    beforeEach(() => {
        jest.resetAllMocks();
        app = express();
        app.use(express.json());
        app.use("/api/v1", userRoutes);
    });

    // ── Helper: Generate valid token ──
    function generateValidToken(user: any): string {
        return jwt.sign({ user }, JWT_SECRET, { expiresIn: "15d" });
    }

    // ── Edge 1: Happy Path — Valid token, user found, name updated ──
    it("updates name and returns new token when user exists", async () => {
        const mockUserFindById = (User as any).findById as jest.Mock<any>;
        const mockGenerateToken = generateToken as jest.Mock<any>;
        const mockSave = jest.fn<() => Promise<void>>()

        const existingUser = {
            _id: "u1",
            name: "OldName",
            email: "test@example.com",
            save: mockSave,
        };

        mockUserFindById.mockResolvedValueOnce(existingUser);
        mockSave.mockResolvedValueOnce(undefined);
        mockGenerateToken.mockReturnValueOnce("new-mock-token");

        const token = generateValidToken({ _id: "u1", name: "OldName" });

        const res = await request(app)
            .post("/api/v1/update/user")
            .set("Authorization", `Bearer ${token}`)
            .send({ name: "NewName" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: "User Updated",
            user: {
                _id: "u1",
                email: "test@example.com",
                name: "NewName",
            },
            token: "new-mock-token",
        });

        expect(existingUser.name).toBe("NewName");
        expect(mockSave).toHaveBeenCalled();
        expect(mockGenerateToken).toHaveBeenCalledWith(existingUser);
    });

    // ── Edge 2: User not found (deleted after token issued) ──
    it("returns 404 when user no longer exists", async () => {
        const mockUserFindById = (User as any).findById as jest.Mock<any>;
        mockUserFindById.mockResolvedValueOnce(null);

        const token = generateValidToken({ _id: "deleted-user", name: "Ghost" });

        const res = await request(app)
            .post("/api/v1/update/user")
            .set("Authorization", `Bearer ${token}`)
            .send({ name: "NewName" });

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: "Please login" });
    });

    // ── Edge 3: No Authorization header ──
    it("returns 401 when Authorization header is missing", async () => {
        const res = await request(app)
            .post("/api/v1/update/user")
            .send({ name: "NewName" });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: "Please Login - No auth header" });
    });

    // ── Edge 4: Invalid/expired token ──
    it("returns 401 when token is invalid", async () => {
        const res = await request(app)
            .post("/api/v1/update/user")
            .set("Authorization", "Bearer invalid-token")
            .send({ name: "NewName" });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: "Please Login - JWT error" });
    });

    // ── Edge 5: Database failure — findById throws ──
    it("returns 500 when User.findById() throws", async () => {
        const mockUserFindById = (User as any).findById as jest.Mock<any>;
        mockUserFindById.mockRejectedValueOnce(new Error("MongoDB connection lost"));

        const token = generateValidToken({ _id: "u1", name: "OldName" });

        const res = await request(app)
            .post("/api/v1/update/user")
            .set("Authorization", `Bearer ${token}`)
            .send({ name: "NewName" });

        expect(res.status).toBe(500);
    });

    // ── Edge 6: Save failure — user.save() throws ──
    it("returns 500 when user.save() throws", async () => {
        const mockUserFindById = (User as any).findById as jest.Mock<any>;
        const mockSave = jest.fn<() => Promise<void>>();

        const existingUser = {
            _id: "u1",
            name: "OldName",
            email: "test@example.com",
            save: mockSave,
        };

        mockUserFindById.mockResolvedValueOnce(existingUser);
        mockSave.mockRejectedValueOnce(new Error("Write conflict"));

        const token = generateValidToken({ _id: "u1", name: "OldName" });

        const res = await request(app)
            .post("/api/v1/update/user")
            .set("Authorization", `Bearer ${token}`)
            .send({ name: "NewName" });

        expect(res.status).toBe(500);
    });
});