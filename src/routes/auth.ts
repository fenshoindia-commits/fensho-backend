import { Router } from "express";
import { LoginSchema, VerifyOtpSchema } from "@fensho/shared";
import prisma from "../prisma";
import jwt from "jsonwebtoken";

const router = Router();

// Mock OTP storage (in-memory or better DB for persistence in dev)
// For this implemention we store in DB
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

router.post("/login", async (req, res) => {
    try {
        const { mobile, role } = LoginSchema.parse(req.body);
        const otpCode = generateOtp();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

        await prisma.otp.create({
            data: {
                mobile,
                code: otpCode,
                expiresAt,
            },
        });

        // In production, send SMS here.
        console.log(`[DEV] OTP for ${mobile}: ${otpCode}`);

        res.json({ message: "OTP sent successfully", dev_otp: otpCode });
    } catch (error) {
        res.status(400).json({ error: "Invalid input" });
    }
});

router.post("/verify-otp", async (req, res) => {
    try {
        const { mobile, code } = VerifyOtpSchema.parse(req.body);

        const otpRecord = await prisma.otp.findFirst({
            where: { mobile, code, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
        });

        if (!otpRecord) {
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        // Find or create user
        let user = await prisma.user.findUnique({ where: { mobile } });
        if (!user) {
            // Default to BUYER if not specified, but usually role should be passed during login or inferred
            // For simplicity, new users are BUYERs unless they go through seller onboarding?
            // Actually, seller onboarding starts with login.
            // We create user here.
            user = await prisma.user.create({
                data: { mobile, role: "BUYER" }, // Default role, upgrade later?
                // Wait, if they chose "SELLER" in UI, we might want to set it here?
                // But for now, simple login.
            });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, mobile: user.mobile },
            process.env.JWT_SECRET as string,
            { expiresIn: "7d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
        });

        res.json({ message: "Login successful", token, user });
    } catch (error) {
        res.status(400).json({ error: "Invalid input" });
    }
});

export default router;
