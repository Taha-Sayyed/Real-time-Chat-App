import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";
import request from "supertest";
import express from "express";

// ── 1. Mock factories: plain jest.fn(), no generics ──
jest.unstable_mockModule("../config/redis.js", () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.unstable_mockModule("../config/generateToken.js", () => ({
  generateToken: jest.fn(),
}));

jest.unstable_mockModule("../model/User.js", () => ({
  User: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

// ── 2. Dynamic imports (must be AFTER unstable_mockModule) ──
const { default: userRoutes } = await import("../routes/user.js");
const { redisClient } = await import("../config/redis.js");
const { generateToken } = await import("../config/generateToken.js");
const { User } = await import("../model/User.js");

// ── 3. Cast to jest.Mock<any, any> — accepts any arg/return, zero never inference ──
const mockRedisGet = redisClient.get as jest.Mock<any>;
const mockRedisDel = redisClient.del as jest.Mock<any>;
const mockGenerateToken = generateToken as jest.Mock<any>;
const mockUserFindOne = (User as any).findOne as jest.Mock<any>;
const mockUserCreate = (User as any).create as jest.Mock<any>;

describe("POST /api/v1/verify", () => {
  let app: express.Express;

  beforeEach(() => {
    jest.resetAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/v1", userRoutes);
  });

  // ── Edge 1: Existing user ──
  it("verifies existing user and returns token", async () => {
    const user = { _id: "u1", name: "testuser", email: "test@example.com" };
    mockRedisGet.mockResolvedValueOnce("123456");
    mockRedisDel.mockResolvedValueOnce(1);
    mockUserFindOne.mockResolvedValueOnce(user);
    mockGenerateToken.mockReturnValueOnce("mock-token");

    const res = await request(app)
      .post("/api/v1/verify")
      .send({ email: "test@example.com", otp: "123456" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "User Verified",
      user,
      token: "mock-token",
    });

    expect(mockRedisGet).toHaveBeenCalledWith("otp:test@example.com");
    expect(mockRedisDel).toHaveBeenCalledWith("otp:test@example.com");
    expect(mockUserFindOne).toHaveBeenCalledWith({ email: "test@example.com" });
    expect(mockGenerateToken).toHaveBeenCalledWith(user);
  });

  // ── Edge 2: New user created ──
  it("creates new user when email not found", async () => {
    const user = { _id: "u2", name: "test@ex", email: "test@example.com" };
    mockRedisGet.mockResolvedValueOnce("654321");
    mockRedisDel.mockResolvedValueOnce(1);
    mockUserFindOne.mockResolvedValueOnce(null);
    mockUserCreate.mockResolvedValueOnce(user);
    mockGenerateToken.mockReturnValueOnce("new-token");

    const res = await request(app)
      .post("/api/v1/verify")
      .send({ email: "test@example.com", otp: "654321" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "User Verified",
      user,
      token: "new-token",
    });

    expect(mockUserCreate).toHaveBeenCalledWith({
      name: "test@ex",
      email: "test@example.com",
    });
  });

  // ── Edge 3: Missing fields ──
  it("returns 400 when email or OTP is missing", async () => {
    const res = await request(app)
      .post("/api/v1/verify")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Email and OTP Required" });
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  // ── Edge 4: Expired OTP (null from Redis) ──
  it("returns 400 when OTP is expired", async () => {
    mockRedisGet.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/v1/verify")
      .send({ email: "test@example.com", otp: "000000" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid or expired OTP" });
    expect(mockRedisDel).not.toHaveBeenCalled();
    expect(mockUserFindOne).not.toHaveBeenCalled();
  });

  // ── Edge 5: OTP mismatch ──
  it("returns 400 when OTP does not match", async () => {
    mockRedisGet.mockResolvedValueOnce("111111");

    const res = await request(app)
      .post("/api/v1/verify")
      .send({ email: "test@example.com", otp: "222222" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid or expired OTP" });
  });

  // ── Edge 6: Redis failure ──
  it("returns 500 when redisClient.get() throws", async () => {
    mockRedisGet.mockRejectedValueOnce(new Error("Redis down"));

    const res = await request(app)
      .post("/api/v1/verify")
      .send({ email: "test@example.com", otp: "123456" });

    expect(res.status).toBe(500);
  });
});