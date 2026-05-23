import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "crypto";
import { describe, it, expect, jest, beforeEach, afterEach, afterAll,beforeAll } from "@jest/globals";


// ── 1. Mock ESM modules with plain jest.fn() factories ──
jest.unstable_mockModule("../model/User.js", () => ({
  User: {
    find: jest.fn(),
  },
}));

// ── 2. Dynamic imports ──
const { default: userRoutes } = await import("../routes/user.js");

describe("GET /api/v1/user/all", () => {
  let app: express.Express;
  let testPrivateKey: string;
  let testPublicKey: string;

  beforeAll(() => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    testPrivateKey = privateKey;
    testPublicKey = publicKey;

    process.env.JWT_PRIVATE_KEY_BASE64 = Buffer.from(privateKey).toString("base64");
    process.env.JWT_PUBLIC_KEY_BASE64 = Buffer.from(publicKey).toString("base64");
  });

  beforeEach(() => {
    jest.resetAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/v1", userRoutes);
  });

  // ── Helper: Generate valid token ──
  function generateValidToken(user: any): string {
    return jwt.sign({ user }, testPrivateKey, {
      algorithm: "RS256",
      expiresIn: "15d",
    });
  }

  // ── Edge 1: Happy Path — Valid token, users returned ──
  it("returns all users when valid Bearer token provided", async () => {
    const users = [
      { _id: "u1", name: "Alice", email: "alice@example.com" },
      { _id: "u2", name: "Bob", email: "bob@example.com" },
    ];
    const mockUserFind = (await import("../model/User.js")).User.find as jest.Mock<any>;
    mockUserFind.mockResolvedValueOnce(users);

    const token = generateValidToken({ _id: "admin1", name: "Admin" });

    const res = await request(app)
      .get("/api/v1/user/all")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(users);
    expect(mockUserFind).toHaveBeenCalledWith();
  });

  // ── Edge 2: No Authorization header ──
  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app).get("/api/v1/user/all");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Please Login - No auth header" });
  });

  // ── Edge 3: Malformed Authorization header ──
  it("returns 401 when Authorization header lacks Bearer prefix", async () => {
    const res = await request(app)
      .get("/api/v1/user/all")
      .set("Authorization", "Basic abc123");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Please Login - No auth header" });
  });

  // ── Edge 4: Invalid/expired token ──
  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .get("/api/v1/user/all")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Please Login - JWT error" });
  });

  // ── Edge 5: Valid token but missing user payload ──
  it("returns 401 when decoded token lacks user field", async () => {
    const badToken = jwt.sign({ foo: "bar" }, testPrivateKey, {
      algorithm: "RS256",
      expiresIn: "15d",
    });

    const res = await request(app)
      .get("/api/v1/user/all")
      .set("Authorization", `Bearer ${badToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Invalid token" });
  });

  // ── Edge 6: Database failure — User.find() throws ──
  it("returns 500 when User.find() throws", async () => {
    const mockUserFind = (await import("../model/User.js")).User.find as jest.Mock<any>;
    mockUserFind.mockRejectedValueOnce(new Error("MongoDB connection lost"));

    const token = generateValidToken({ _id: "admin1", name: "Admin" });

    const res = await request(app)
      .get("/api/v1/user/all")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});