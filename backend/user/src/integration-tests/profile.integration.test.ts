import request from "supertest";
import express, { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { generateKeyPairSync, createPrivateKey } from "crypto";
import { describe, it, expect, jest, beforeEach, afterEach, afterAll, beforeAll } from "@jest/globals";


// ── 1. Mock ESM modules with plain jest.fn() factories ──
jest.unstable_mockModule("../model/User.js", () => ({
    User: {
        findOne: jest.fn(),
        create: jest.fn(),
    },
}));

// ── 2. Dynamic imports ──
const { default: userRoutes } = await import("../routes/user.js");

describe("GET /api/v1/me", () => {
    let app: express.Express;
    let testPrivateKey: string;
    let testPublicKey: string;
    let wrongPrivateKey: string;

    beforeAll(() => {
        const { privateKey: pk1, publicKey: pbk1 } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
        });
        testPrivateKey = pk1;
        testPublicKey = pbk1;

        process.env.JWT_PRIVATE_KEY_BASE64 = Buffer.from(pk1).toString("base64");
        process.env.JWT_PUBLIC_KEY_BASE64 = Buffer.from(pbk1).toString("base64");

        const { privateKey: pk2 } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
        });
        wrongPrivateKey = pk2;
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

    // ── Edge 1: Happy Path — Valid token, user returned ──
    it("returns user profile when valid Bearer token provided", async () => {
        const user = { _id: "u1", name: "Alice", email: "alice@example.com" };
        const token = generateValidToken(user);

        const res = await request(app)
            .get("/api/v1/me")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual(user);
    });

    // ── Edge 2: No Authorization header ──
    it("returns 401 when Authorization header is missing", async () => {
        const res = await request(app).get("/api/v1/me");

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: "Please Login - No auth header" });
    });

    // ── Edge 3: Malformed Authorization header (no Bearer prefix) ──
    it("returns 401 when Authorization header lacks Bearer prefix", async () => {
        const res = await request(app)
            .get("/api/v1/me")
            .set("Authorization", "Basic abc123");

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: "Please Login - No auth header" });
    });

    // ── Edge 4: Invalid/expired token ──
    it("returns 401 when token is invalid or expired", async () => {
        const res = await request(app)
            .get("/api/v1/me")
            .set("Authorization", "Bearer invalid-token-here");

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
            .get("/api/v1/me")
            .set("Authorization", `Bearer ${badToken}`);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: "Invalid token" });
    });

    // ── Edge 6: Wrong RSA key pair used to sign token ──
    it("returns 401 when token signed with different key", async () => {
        const wrongToken = jwt.sign(
            { user: { _id: "u2", name: "Bob" } },
            wrongPrivateKey,
            { algorithm: "RS256", expiresIn: "15d" }
        );

        const res = await request(app)
            .get("/api/v1/me")
            .set("Authorization", `Bearer ${wrongToken}`);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: "Please Login - JWT error" });
    });
});