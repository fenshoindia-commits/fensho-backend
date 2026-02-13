import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface AuthRequest extends Request {
    user?: {
        id: string;
        role: string;
        mobile: string;
    };
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
        (req as AuthRequest).user = decoded as any;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid token" });
    }
};

export const authorize = (roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const userKey = (req as AuthRequest).user;
        if (!userKey || !roles.includes(userKey.role)) {
            return res.status(403).json({ error: "Forbidden" });
        }
        next();
    };
};
