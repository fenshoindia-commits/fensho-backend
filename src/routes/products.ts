import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { ProductCreateSchema } from "@fensho/shared";
import prisma from "../prisma";

const router = Router();

router.post("/", authenticate, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const seller = await prisma.sellerProfile.findUnique({ where: { userId } });

        if (!seller || seller.kycStatus !== "VERIFIED") {
            return res.status(403).json({ error: "Only verified sellers can add products" });
        }

        const body = ProductCreateSchema.parse(req.body);

        const product = await prisma.product.create({
            data: {
                ...body,
                sellerProfileId: seller.id,
            },
        });

        res.json(product);
    } catch (error) {
        res.status(400).json({ error: "Invalid input" });
    }
});

router.get("/", async (req, res) => {
    const { state } = req.query;

    if (!state) {
        return res.status(400).json({ error: "State parameter is required" });
    }

    const buyerState = (state as string).trim();

    const products = await prisma.product.findMany({
        where: {
            isActive: true,
            OR: [
                { sellerProfile: { type: "GST" } },
                {
                    AND: [
                        { sellerProfile: { type: "PAN_ONLY" } },
                        { sellerProfile: { state: { equals: buyerState, mode: 'insensitive' } } }
                    ]
                }
            ]
        },
        include: { sellerProfile: { select: { storeName: true, type: true, state: true } } },
    });

    res.json(products);
});



router.get("/:id", async (req, res) => {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
        where: { id },
        include: { sellerProfile: true },
    });

    // Also valid visibility logic here ideally
    res.json(product);
});

export default router;
