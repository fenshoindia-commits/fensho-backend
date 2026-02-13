import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import prisma from "../prisma";
import { createAuditLog } from "../services/auditService";
import { processRazorpayRefund } from "../services/paymentService";

const router = Router();

router.get("/kyc-queue", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const pendingSellers = await prisma.sellerProfile.findMany({
        where: { kycStatus: "SUBMITTED" },
        include: { documents: true },
    });
    res.json(pendingSellers);
});

router.post("/kyc-action", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const { sellerProfileId, action, reason } = req.body;

    if (!["APPROVE", "REJECT"].includes(action)) {
        return res.status(400).json({ error: "Invalid action" });
    }

    const status = action === "APPROVE" ? "VERIFIED" : "REJECTED";

    const updatedProfile = await prisma.sellerProfile.update({
        where: { id: sellerProfileId },
        data: {
            kycStatus: status,
            rejectionReason: action === "REJECT" ? reason : null
        },
    });

    res.json({ message: `Seller KYC ${status}`, updatedProfile });
});

router.get("/buyers", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const buyers = await prisma.buyerProfile.findMany({
        include: { user: { select: { mobile: true } } }
    });
    res.json(buyers);
});

router.get("/buyers/:id/risk-events", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const events = await prisma.riskEvent.findMany({
        where: { userId: req.params.id },
        orderBy: { createdAt: "desc" }
    });
    res.json(events);
});

router.post("/buyers/:id/override-cod", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const { codAllowed, codLimitAmount, dailyCodOrdersLimit } = req.body;
    const profile = await prisma.buyerProfile.update({
        where: { id: req.params.id },
        data: {
            codAllowed,
            codLimitAmount,
            dailyCodOrdersLimit
        }
    });

    await prisma.riskEvent.create({
        data: {
            userId: profile.userId,
            type: "MANUAL_OVERRIDE",
            points: 0,
            note: `Admin override: COD=${codAllowed}, Limit=${codLimitAmount}`
        }
    });

    res.json(profile);
});

router.post("/buyers/:id/reset-risk", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const profile = await prisma.buyerProfile.update({
        where: { id: req.params.id },
        data: { riskScore: 0 }
    });

    await prisma.riskEvent.create({
        data: {
            userId: profile.userId,
            type: "MANUAL_OVERRIDE",
            points: 0,
            note: "Risk score reset by admin"
        }
    });

    res.json(profile);
});

router.get("/shipments", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const shipments = await prisma.shipment.findMany({
        include: { order: true },
        orderBy: { createdAt: "desc" }
    });
    res.json(shipments);
});

router.post("/shipments/:awb/status", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const { awb } = req.params;
    const { status } = req.body;

    // Simulate webhook behavior
    const shipment = await prisma.shipment.findUnique({ where: { awb } });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });

    // In a real mock, we'd call the /webhooks/fensho endpoint internally or mirror logic
    // For simplicity, we just trigger the status update logic
    const updatedOrder = await prisma.order.update({
        where: { id: shipment.orderId },
        data: { orderStatus: status === "DELIVERED" ? "DELIVERED" : status === "RTO" ? "RTO" : undefined, logisticsStatus: status }
    });

    await prisma.shipment.update({
        where: { awb },
        data: { status, lastEventAt: new Date() }
    });

    // Handle financial side effects if status changed to DELIVERED/RTO (extracted to a shared service is better, but here we mirror/call)
    // For now we assume this simulation endpoint helps frontend devs test UI states

    await createAuditLog({
        actorId: (req as any).user.id,
        actorRole: "ADMIN",
        action: "SHIPMENT_STATUS_SIMULATE",
        targetId: awb,
        metadata: { status }
    });

    res.json({ message: "Status simulated", status });
});

router.post("/orders/:id/refund", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const { id } = req.params;
    const { amount } = req.body;

    const order = await prisma.order.findUnique({
        where: { id },
        include: { items: true }
    });

    if (!order || order.paymentStatus !== "PAID") {
        return res.status(400).json({ error: "Only PAID orders can be refunded" });
    }

    try {
        const refund = await processRazorpayRefund(order.razorpayPaymentId!, amount);

        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id },
                data: {
                    paymentStatus: "REFUNDED",
                    refundAmount: { increment: amount || Number(order.totalAmount) }
                }
            });

            const sellerId = order.items[0]?.productId ? (await tx.product.findUnique({ where: { id: order.items[0].productId }, include: { sellerProfile: true } }))?.sellerProfile.userId : null;

            if (sellerId && order.orderStatus === "DELIVERED") {
                // REVERSAL LOGIC
                const reversalAmt = amount || (order.sellerEarning || 0);
                await tx.sellerWallet.update({
                    where: { sellerId },
                    data: { availableBalance: { decrement: reversalAmt } }
                });
                await tx.ledgerEntry.create({
                    data: { sellerId, orderId: id, type: "REFUND_REVERSAL", amount: -reversalAmt, note: `Refund reversal for order ${id}` }
                });
            }

            await tx.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    actorRole: "ADMIN",
                    action: "ORDER_REFUND",
                    targetId: id,
                    metadata: { amount, refundId: refund.id }
                }
            });
        });

        res.json({ message: "Refund processed successfully" });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/orders/:id/status", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const { status } = req.body; // PLACED, SHIPPED, DELIVERED, RTO, CANCELLED
    const orderId = req.params.id;

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            buyer: { include: { buyerProfile: true } },
            items: { include: { product: { include: { sellerProfile: true } } } }
        }
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    // Ensure atomic update
    const updatedOrder = await prisma.$transaction(async (tx) => {
        const uo = await tx.order.update({
            where: { id: orderId },
            data: { orderStatus: status as any }
        });

        // 1. RISK SCORE LOGIC (Buyer)
        let points = 0;
        let type: any = null;

        if (status === "DELIVERED") { points = -5; type = "DELIVERED"; }
        else if (status === "CANCELLED") { points = 10; type = "CANCEL"; }
        else if (status === "RTO") { points = 25; type = "RTO"; }

        if (type) {
            const currentRisk = order.buyer.buyerProfile?.riskScore || 0;
            const newRisk = Math.max(0, currentRisk + points);
            await tx.buyerProfile.update({
                where: { userId: order.buyerId },
                data: {
                    riskScore: newRisk,
                    deliveredOrders: status === "DELIVERED" ? { increment: 1 } : undefined,
                    cancelledOrders: status === "CANCELLED" ? { increment: 1 } : undefined,
                    rtoOrders: status === "RTO" ? { increment: 1 } : undefined,
                }
            });
            await tx.riskEvent.create({
                data: { userId: order.buyerId, type, points, note: `Order ${orderId} -> ${status}` }
            });
        }

        // 2. FINANCIAL LOGIC (Seller)
        if (status === "DELIVERED" && !order.settlementEligibleAt) {
            const sellerProfile = order.items[0]?.product.sellerProfile;
            if (sellerProfile) {
                const commissionRate = sellerProfile.commissionRate || 0.10;
                const tdsPercentage = sellerProfile.tdsPercentage || 0;
                const totalAmount = Number(order.totalAmount);

                const commissionAmount = totalAmount * commissionRate;
                const preTdsEarning = totalAmount - commissionAmount;
                const tdsAmount = preTdsEarning * tdsPercentage;
                const sellerEarning = preTdsEarning - tdsAmount;

                const settlementEligibleAt = new Date();
                settlementEligibleAt.setDate(settlementEligibleAt.getDate() + 7);

                await tx.order.update({
                    where: { id: orderId },
                    data: {
                        commissionAmount,
                        tdsAmount,
                        sellerEarning,
                        settlementEligibleAt
                    }
                });

                // Ensure Wallet exists
                let wallet = await tx.sellerWallet.findUnique({ where: { sellerId: sellerProfile.userId } });
                if (!wallet) {
                    wallet = await tx.sellerWallet.create({ data: { sellerId: sellerProfile.userId } });
                }

                // Ledger Entries
                await tx.ledgerEntry.createMany({
                    data: [
                        { sellerId: sellerProfile.userId, orderId, type: "SALE", amount: totalAmount, note: `Order ${orderId} Sale` },
                        { sellerId: sellerProfile.userId, orderId, type: "COMMISSION", amount: -commissionAmount, note: `Platform Commission (${commissionRate * 100}%)` },
                        ...(tdsAmount > 0 ? [{ sellerId: sellerProfile.userId, orderId, type: "TDS", amount: -tdsAmount, note: `TDS Deduction (${tdsPercentage * 100}%)` }] : [])
                    ]
                });

                // Wallet Updates & Routing
                if (order.paymentMethod === "COD") {
                    await tx.sellerWallet.update({
                        where: { sellerId: sellerProfile.userId },
                        data: {
                            holdBalance: { increment: sellerEarning },
                            totalSales: { increment: totalAmount },
                            totalCommission: { increment: commissionAmount }
                        }
                    });
                    await tx.ledgerEntry.create({
                        data: { sellerId: sellerProfile.userId, orderId, type: "HOLD", amount: -sellerEarning, note: "COD Hold until reconciliation" }
                    });
                } else {
                    await tx.sellerWallet.update({
                        where: { sellerId: sellerProfile.userId },
                        data: {
                            availableBalance: { increment: sellerEarning },
                            totalSales: { increment: totalAmount },
                            totalCommission: { increment: commissionAmount }
                        }
                    });
                }
            }
        }
        return uo;
    });

    await createAuditLog({
        actorId: (req as any).user.id,
        actorRole: "ADMIN",
        action: "ORDER_STATUS_UPDATE",
        targetId: orderId,
        metadata: { status }
    });

    res.json(updatedOrder);
});

router.post("/orders/:id/cod-received", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const order = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { product: { include: { sellerProfile: true } } } } }
    });

    if (!order || order.paymentMethod !== "COD" || order.codReconciled) {
        return res.status(400).json({ error: "Invalid order or already reconciled" });
    }

    const sellerId = order.items[0]?.product.sellerProfile.userId;
    const amount = order.sellerEarning || 0;

    await prisma.$transaction([
        prisma.order.update({ where: { id: order.id }, data: { codReconciled: true } }),
        prisma.sellerWallet.update({
            where: { sellerId },
            data: {
                holdBalance: { decrement: amount },
                availableBalance: { increment: amount }
            }
        }),
        prisma.ledgerEntry.create({
            data: { sellerId, orderId: order.id, type: "RELEASE", amount, note: "COD Reconciled - Funds Released" }
        })
    ]);

    res.json({ message: "COD Reconciled Successfully" });
});

router.post("/sellers/:id/payout", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const sellerId = req.params.id; // User ID
    const now = new Date();

    const wallet = await prisma.sellerWallet.findUnique({ where: { sellerId } });
    if (!wallet || wallet.availableBalance <= 0) {
        return res.status(400).json({ error: "No available balance for payout" });
    }

    // Find eligible orders
    const eligibleOrders = await prisma.order.findMany({
        where: {
            items: { some: { product: { sellerProfile: { userId: sellerId } } } },
            orderStatus: "DELIVERED",
            settled: false,
            settlementEligibleAt: { lte: now },
            OR: [
                { paymentMethod: "ONLINE" },
                { AND: [{ paymentMethod: "COD" }, { codReconciled: true }] }
            ]
        }
    });

    if (eligibleOrders.length === 0) {
        return res.status(400).json({ error: "No eligible orders found for settlement" });
    }

    const payoutAmount = eligibleOrders.reduce((sum, o) => sum + (o.sellerEarning || 0), 0);

    await prisma.$transaction([
        prisma.sellerWallet.update({
            where: { sellerId },
            data: {
                availableBalance: { decrement: payoutAmount },
                totalPayout: { increment: payoutAmount }
            }
        }),
        prisma.ledgerEntry.create({
            data: { sellerId, type: "PAYOUT", amount: -payoutAmount, note: `Settlement for ${eligibleOrders.length} orders` }
        }),
        prisma.order.updateMany({
            where: { id: { in: eligibleOrders.map(o => o.id) } },
            data: { settled: true }
        })
    ]);

    res.json({ message: "Payout Processed", payoutAmount, ordersCount: eligibleOrders.length });
});

router.put("/sellers/:id/commission", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const { commissionRate, tdsPercentage, isGstSeller } = req.body;
    const updated = await prisma.sellerProfile.update({
        where: { userId: req.params.id },
        data: {
            commissionRate: commissionRate !== undefined ? Number(commissionRate) : undefined,
            tdsPercentage: tdsPercentage !== undefined ? Number(tdsPercentage) : undefined,
            isGstSeller
        }
    });
    res.json(updated);
});

router.get("/finance-summary", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const sellers = await prisma.sellerProfile.findMany({
        include: {
            user: { include: { wallet: true } }
        }
    });
    res.json(sellers);
});

// Courier Management
router.get("/courier-configs", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const configs = await prisma.courierConfig.findMany({
        orderBy: { priority: "asc" }
    });
    res.json(configs);
});

router.post("/courier-configs", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const { name, baseUrl, apiKey, priority, isActive, supportsCOD, maxCodAmount } = req.body;
    const config = await prisma.courierConfig.upsert({
        where: { name },
        update: { baseUrl, apiKey, priority, isActive, supportsCOD, maxCodAmount },
        create: { name, baseUrl, apiKey, priority, isActive, supportsCOD, maxCodAmount }
    });
    res.json(config);
});

router.delete("/courier-configs/:id", authenticate, authorize(["ADMIN"]), async (req, res) => {
    await prisma.courierConfig.delete({ where: { id: req.params.id } });
    res.sendStatus(200);
});

router.get("/products/audit", authenticate, authorize(["ADMIN"]), async (req, res) => {
    const products = await prisma.product.findMany({
        where: {
            OR: [
                { weightGrams: { equals: 0 } },
                { lengthCm: { equals: 0 } },
                { widthCm: { equals: 0 } },
                { heightCm: { equals: 0 } },
                { weightGrams: null },
                { lengthCm: null },
                { widthCm: null },
                { heightCm: null }
            ]
        },
        include: { sellerProfile: true }
    });
    res.json(products);
});

export default router;

