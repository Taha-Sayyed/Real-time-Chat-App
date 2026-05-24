import jwt, { SignOptions } from "jsonwebtoken";
import { createPrivateKey } from "crypto";
import dotenv from "dotenv";

dotenv.config();

const privateKeyPem = Buffer.from(
  process.env.JWT_PRIVATE_KEY_BASE64 as string,
  "base64"
).toString("utf-8");

const privateKey = createPrivateKey({
  key: privateKeyPem,
  format: "pem",
});

export const generateToken = (user: any) => {
  return jwt.sign(
    { user },
    privateKey,
    {
      algorithm: "RS256",
      expiresIn: process.env.JWT_EXPIRES_IN ?? "15d",
    } as SignOptions
  );
};