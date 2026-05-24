import { NextFunction, Request, Response } from "express";
import { IUser } from "../model/User.js";
import jwt, { JwtPayload, VerifyOptions } from "jsonwebtoken";
import { createPublicKey } from "crypto";


export interface AuthenticatedRequest extends Request {
    user?: IUser | null;
}

export const isAuth = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({
                message: "Please Login - No auth header",
            });
            return;
        }

        const token = authHeader.split(" ")[1];

        const publicKeyPem = Buffer.from(
            process.env.JWT_PUBLIC_KEY_BASE64 as string,
            "base64"
        ).toString("utf-8");

        const publicKey = createPublicKey({
            key: publicKeyPem,
            format: "pem",
        });

        const decodedValue = jwt.verify(
            token,
            publicKey,
            {
                algorithms: ["RS256"],
            } as VerifyOptions
        ) as JwtPayload

        if (!decodedValue || !decodedValue.user) {
            res.status(401).json({
                message: "Invalid token",
            });
            return;
        }

        req.user = decodedValue.user;

        next();

    } catch (error) {
        res.status(401).json({
            message: "Please Login - JWT error",
        });
    }
}