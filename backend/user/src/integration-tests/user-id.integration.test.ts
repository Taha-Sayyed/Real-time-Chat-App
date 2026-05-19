import request from "supertest";
import express from "express";
import { describe, it, expect, jest, beforeEach, afterEach, afterAll, beforeAll } from "@jest/globals";


// ── 1. Mock ESM modules with plain jest.fn() factories ──
jest.unstable_mockModule("../model/User.js", () => ({
  User: {
    findById: jest.fn(),
  },
}));

// ── 2. Dynamic imports ──
const { default: userRoutes } = await import("../routes/user.js");

describe("GET /api/v1/user/:id", () => {
  let app: express.Express;

  beforeEach(() => {
    jest.resetAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/v1", userRoutes);
  });

  // ── Edge 1: Happy Path — Valid ID, user found ──
  it("returns user when valid ID and user exists", async () => {
    const mockUserFindById = (await import("../model/User.js")).User.findById as jest.Mock<any>;
    const user = { _id: "u1", name: "Alice", email: "alice@example.com" };
    mockUserFindById.mockResolvedValueOnce(user);

    const res = await request(app).get("/api/v1/user/u1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(user);
    expect(mockUserFindById).toHaveBeenCalledWith("u1");
  });

  // ── Edge 2: User not found — Valid ID format but no user ──
  it("returns null when user does not exist", async () => {
    const mockUserFindById = (await import("../model/User.js")).User.findById as jest.Mock<any>;
    mockUserFindById.mockResolvedValueOnce(null);

    const res = await request(app).get("/api/v1/user/nonexistent");

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(mockUserFindById).toHaveBeenCalledWith("nonexistent");
  });

  // ── Edge 3: Invalid ObjectId format ──
  it("returns 500 when ID format is invalid (Mongoose cast error)", async () => {
    const mockUserFindById = (await import("../model/User.js")).User.findById as jest.Mock<any>;
    mockUserFindById.mockRejectedValueOnce(new Error("Cast to ObjectId failed"));

    const res = await request(app).get("/api/v1/user/invalid-id-format");

    expect(res.status).toBe(500);
  });

  // ── Edge 4: Database connection failure ──
  it("returns 500 when User.findById() throws DB error", async () => {
    const mockUserFindById = (await import("../model/User.js")).User.findById as jest.Mock<any>;
    mockUserFindById.mockRejectedValueOnce(new Error("MongoDB connection lost"));

    const res = await request(app).get("/api/v1/user/u1");

    expect(res.status).toBe(500);
  });

  // ── Edge 5: Empty ID parameter ──
  it("handles empty ID parameter gracefully", async () => {
    const mockUserFindById = (await import("../model/User.js")).User.findById as jest.Mock<any>;
    mockUserFindById.mockResolvedValueOnce(null);

    const res = await request(app).get("/api/v1/user/");

    expect(res.status).toBe(404); // Express route mismatch, falls through to 404
  });

  // ── Edge 6: Special characters in ID ──
  it("handles special characters in ID parameter", async () => {
    const mockUserFindById = (await import("../model/User.js")).User.findById as jest.Mock<any>;
    mockUserFindById.mockResolvedValueOnce(null);

    const res = await request(app).get("/api/v1/user/abc-123_test%20space");

    expect(res.status).toBe(200);
    expect(mockUserFindById).toHaveBeenCalledWith("abc-123_test space");
  });
});