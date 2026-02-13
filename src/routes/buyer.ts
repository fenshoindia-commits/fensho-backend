import { Router } from "express";
import { authenticate } from "../middleware/auth";
import prisma from "../prisma";
import { BuyerProfileSchema, AddressSchema } from "@fensho/shared";
import { LogisticsRouterService } from "../services/logisticsRouter";
import { createRazorpayOrder, verifyRazorpaySignature } from "../services/paymentService";
import { paymentLimiter } from "../middleware/security";

const router = Router();

router.post("/profile", authenticate, async (req, res) => {
    const userId = (req as any).user.id;
    const body = BuyerProfileSchema.parse(req.body);

    const profile = await prisma.buyerProfile.upsert({
        where: { userId },
        update: body,
        create: { ...body, userId },
    });

    res.json(profile);
});

router.post("/address", authenticate, async (req, res) => {
    const userId = (req as any).user.id;
    const body = AddressSchema.parse(req.body);

    const address = await prisma.address.create({
        data: { ...body, userId },
    });

    res.json(address);
});

router.get("/me", authenticate, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const profile = await prisma.buyerProfile.findUnique({
            where: { userId },
            include: { user: { select: { mobile: true, state: true } } }
        });

        if (!profile) {
            // Create default profile if missing
            const newProfile = await prisma.buyerProfile.create({
                data: { userId },
                include: { user: { select: { mobile: true, state: true } } }
            });
            return res.json(newProfile);
        }

        res.json(profile);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/order", authenticate, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const { items, addressId, paymentMethod = "ONLINE" } = req.body;

        const address = await prisma.address.findUnique({ where: { id: addressId } });
        if (!address) return res.status(400).json({ error: "Invalid address" });

        const buyerProfile = await prisma.buyerProfile.findUnique({ where: { userId } });
        if (!buyerProfile) {
            await prisma.buyerProfile.create({ data: { userId } });
        }

        const profile = (await prisma.buyerProfile.findUnique({ where: { userId } }))!;
        const buyerState = address.state;
        let totalAmount = 0;
        const finalItems = [];

        // COD CHECKS
        if (paymentMethod === "COD") {
            if (!profile.codAllowed) {
                return res.status(400).json({ error: "COD not available. Please choose Online Payment.", reason: "COD_DISABLED" });
            }
            if (profile.riskScore >= 60) {
                return res.status(400).json({ error: "COD not available. Please choose Online Payment.", reason: "HIGH_RISK" });
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayCodOrders = await prisma.order.count({
                where: {
                    buyerId: userId,
                    paymentMethod: "COD",
                    createdAt: { gte: today }
                }
            });

            if (todayCodOrders >= profile.dailyCodOrdersLimit) {
                return res.status(400).json({ error: "Daily COD limit reached. Please choose Online Payment.", reason: "DAILY_LIMIT" });
            }
        }

        let sellerTypeSnapshot = "GST";
        let originState = "";

        for (const item of items) {
            const product = await prisma.product.findUnique({
                where: { id: item.productId },
                include: { sellerProfile: true }
            });

            if (!product) {
                return res.status(404).json({ error: `Product with ID ${item.productId} not found` });
            }

            originState = product.sellerProfile.state || "";

            if (product.sellerProfile.type === "PAN_ONLY") {
                sellerTypeSnapshot = "PAN_ONLY";
                if (product.sellerProfile.state?.toLowerCase().trim() !== buyerState.toLowerCase().trim()) {
                    return res.status(400).json({
                        error: "This seller delivers only within their state."
                    });
                }
            }

            finalItems.push({
                productId: product.id,
                quantity: item.quantity,
                price: product.price,
                weight: product.weightGrams,
                volumetricWeight: product.volumetricWeight,
                shippingClass: product.shippingClass,
                isFragile: product.isFragile
            });
            totalAmount += Number(product.price) * item.quantity;
        }

        if (paymentMethod === "COD" && totalAmount > profile.codLimitAmount) {
            return res.status(400).json({ error: `COD not available for orders above ₹${profile.codLimitAmount}.`, reason: "AMOUNT_LIMIT" });
        }

        // RAZORPAY ORDER
        let rpOrderId = null;
        if (paymentMethod === "ONLINE") {
            const rpOrder = await createRazorpayOrder(userId, totalAmount);
            rpOrderId = rpOrder.id;
        }

        const order = await prisma.order.create({
            data: {
                buyerId: userId,
                totalAmount,
                status: "PENDING",
                orderStatus: "PLACED",
                paymentMethod: paymentMethod as any,
                paymentStatus: "PENDING",
                buyerState,
                sellerTypeSnapshot,
                riskSnapshot: profile.riskScore,
                razorpayOrderId: rpOrderId,
                items: {
                    create: finalItems.map(i => ({
                        productId: i.productId,
                        quantity: i.quantity,
                        price: i.price,
                        weight: i.weight,
                        volumetricWeight: i.volumetricWeight,
                        shippingClass: i.shippingClass,
                        isFragile: i.isFragile
                    }))
                },
            },
            include: { items: true },
        });

        // SHIPMENT CREATION via Router
        await LogisticsRouterService.routeOrder(order.id);

        // Increment lifetime orders
        await prisma.buyerProfile.update({
            where: { userId },
            data: { lifetimeOrders: { increment: 1 } }
        });

        res.json({
            message: "Order initiated",
            order,
            razorpayOrderId: rpOrderId,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error("Order error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/payments/verify", authenticate, paymentLimiter, async (req, res) => {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
        return res.status(400).json({ error: "Invalid signature" });
    }

    await prisma.order.update({
        where: { id: orderId },
        data: {
            paymentStatus: "PAID",
            razorpayPaymentId,
            razorpaySignature
        }
    });

    await prisma.paymentEvent.create({
        data: {
            orderId,
            type: "PAYMENT_SUCCESS",
            rawData: req.body
        }
    });

    res.json({ message: "Payment verified successfully" });
});



router.put("/state", authenticate, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const { state } = req.body;

        if (!state) return res.status(400).json({ error: "State is required" });

        const normalizedState = state.trim().toUpperCase();

        await prisma.user.update({
            where: { id: userId },
            data: { state: normalizedState }
        });

        res.json({ message: "State updated successfully", state: normalizedState });
    } catch (error) {
        console.error("Update state error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


router.get("/orders", authenticate, async (req, res) => {
    const userId = (req as any).user.id;
    const orders = await prisma.order.findMany({
        where: { buyerId: userId },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: "desc" },
    });
    res.json(orders);
});

export default router;
