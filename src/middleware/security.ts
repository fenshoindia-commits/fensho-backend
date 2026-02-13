import rateLimit from "express-rate-limit";

// Centralized limits
export const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10,
    message: { error: "Too many login attempts, please try again after 5 minutes" },
    standardHeaders: true,
    legacyHeaders: false,
});

export const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    message: { error: "Too many OTP attempts, please try again after 10 minutes" },
    standardHeaders: true,
    legacyHeaders: false,
});

export const paymentLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    message: { error: "Too many payment verification attempts" },
    standardHeaders: true,
    legacyHeaders: false,
});

export const webhookLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 300,
    message: { error: "Webhook rate limit exceeded" },
    standardHeaders: true,
    legacyHeaders: false,
});

// Centralized Error Handler
import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    console.error(`[ERROR] [${requestId}] ${err.stack || err.message}`);

    const status = err.status || 500;
    const message = status === 500 ? "Internal Server Error" : err.message;

    res.status(status).json({
        requestId,
        code: err.code || "UNKNOWN_ERROR",
        message
    });
};
