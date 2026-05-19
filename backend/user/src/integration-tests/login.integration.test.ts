import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";
import request from "supertest";
import express from "express";
import type { RedisClient, PublishToQueue } from "../interfaces/interface_types.js";

// ── 1. Create typed mock functions FIRST ──
const mockRedisGet = jest.fn<RedisClient["get"]>();
const mockRedisSet = jest.fn<RedisClient["set"]>();
const mockRedisDel = jest.fn<RedisClient["del"]>();
const mockPublishToQueue = jest.fn<PublishToQueue>();

// ── 2. Mock ESM modules (jest.mock is broken in ESM) ──
jest.unstable_mockModule("../config/redis.js", () => ({
  redisClient: {
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  },
}));

jest.unstable_mockModule("../config/rabbitmq.js", () => ({
  publishToQueue: mockPublishToQueue,
}));

// ── 3. Dynamic import of routes AFTER mocks are established ──
const { default: userRoutes } = await import("../routes/user.js");

// ── 4. Tests ──
describe("POST /api/v1/login", () => {
  let app: express.Express;

  beforeEach(() => {
    jest.resetAllMocks(); // clears queued one-time return values
    app = express();
    app.use(express.json());
    app.use("/api/v1", userRoutes);
  });

  it("sends OTP when no rate limit exists", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockRedisSet.mockResolvedValueOnce("OK");
    mockPublishToQueue.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post("/api/v1/login")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "OTP sent to your mail" });

    expect(mockRedisGet).toHaveBeenCalledWith("otp:ratelimit:test@example.com");
    expect(mockRedisSet).toHaveBeenNthCalledWith(
      1,
      "otp:test@example.com",
      expect.stringMatching(/^\d{6}$/),
      { EX: 300 }
    );
    expect(mockRedisSet).toHaveBeenNthCalledWith(
      2,
      "otp:ratelimit:test@example.com",
      "true",
      { EX: 60 }
    );
    expect(mockPublishToQueue).toHaveBeenCalledWith(
      "send-otp",
      expect.objectContaining({
        to: "test@example.com",
        subject: "Your otp code",
        body: expect.stringMatching(/Your OTP is \d{6}\. It is valid for 5 minutes/),
      })
    );
  });

  it("returns 429 when rate limit is active", async () => {
    mockRedisGet.mockResolvedValueOnce("true");

    const res = await request(app)
      .post("/api/v1/login")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too may requests/i);
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockPublishToQueue).not.toHaveBeenCalled();
  });

  it("handles missing email without crashing", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockRedisSet.mockResolvedValueOnce("OK");
    mockPublishToQueue.mockResolvedValueOnce(undefined);

    const res = await request(app).post("/api/v1/login").send({});

    expect(res.status).toBe(200);
    expect(mockRedisGet).toHaveBeenCalledWith("otp:ratelimit:undefined");
  });

  it("returns 500 when redisClient.get() fails", async () => {
    mockRedisGet.mockRejectedValueOnce(new Error("Redis down"));

    const res = await request(app)
      .post("/api/v1/login")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(500);
  });

  it("returns 500 when redisClient.set() fails", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockRedisSet.mockRejectedValueOnce(new Error("SET failed"));

    const res = await request(app)
      .post("/api/v1/login")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(500);
    expect(mockPublishToQueue).not.toHaveBeenCalled();
  });

  it("returns 500 when publishToQueue() fails", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockRedisSet.mockResolvedValueOnce("OK");
    mockPublishToQueue.mockRejectedValueOnce(new Error("RabbitMQ down"));

    const res = await request(app)
      .post("/api/v1/login")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(500);
    expect(mockRedisSet).toHaveBeenCalledTimes(2);
  });
});