import { Router, Request } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { SellerKycSchema } from "../types/shared";
import prisma from "../prisma";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();
const upload = multer({ dest: "uploads/" }); // Simple local upload

router.post("/onboarding", authenticate, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const body = SellerKycSchema.parse(req.body);

        // Validate GST logic
        if (body.type === "GST" && !body.gstNumber) {
            return res.status(400).json({ error: "GST Number is required for GST sellers" });
        }

        // Update user role to SELLER if not already
        await prisma.user.update({
            where: { id: userId },
            data: { role: "SELLER" },
        });

        // Upsert profile
        const profile = await prisma.sellerProfile.upsert({
            where: { userId },
            update: { ...body, kycStatus: "SUBMITTED" },
            create: { ...body, userId, kycStatus: "SUBMITTED" },
        });

        res.json({ message: "KYC Submitted", profile });
    } catch (error) {
        res.status(400).json({ error: "Invalid input or validation failed" });
    }
});

router.post("/upload-doc", authenticate, upload.single("file"), async (req, res) => {
    // Save file info to DB
    // For now just return the path
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // In real app, upload to S3 here
    const url = `/uploads/${req.file.filename}`;

    // We need to know which doc type this is, passed in body maybe?
    const { docType } = req.body; // PAN_CARD, etc.

    // Link to seller profile
    const userId = (req as any).user.id;
    const profile = await prisma.sellerProfile.findUnique({ where: { userId } });

    if (profile) {
        await prisma.document.create({
            data: {
                sellerProfileId: profile.id,
                type: docType,
                url: url,
                status: "PENDING"
            }
        });
    }

    res.json({ url });
});

router.get("/me", authenticate, async (req, res) => {
    const userId = (req as any).user.id;
    const profile = await prisma.sellerProfile.findUnique({
        where: { userId },
        include: { documents: true },
    });
    res.json(profile);
});

router.get("/wallet", authenticate, async (req, res) => {
    const userId = (req as any).user.id;
    let wallet = await prisma.sellerWallet.findUnique({
        where: { sellerId: userId }
    });

    if (!wallet) {
        wallet = await prisma.sellerWallet.create({
            data: { sellerId: userId }
        });
    }

    res.json(wallet);
});

router.get("/ledger", authenticate, async (req, res) => {
    const userId = (req as any).user.id;
    const ledger = await prisma.ledgerEntry.findMany({
        where: { sellerId: userId },
        orderBy: { createdAt: "desc" }
    });
    res.json(ledger);
});

export default router;
