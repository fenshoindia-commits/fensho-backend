import { Router, Request, Response } from "express";
import prisma from "../prisma";
import { webhookLimiter } from "../middleware/security";
import { verifyFendexSignature, ShipmentStatus } from "../services/logisticsService";
import { verifyRazorpayWebhook } from "../services/paymentService";
import { createAuditLog, createIdempotencyKey } from "../services/auditService";

const router = Router();

// Dynamic Courier Webhook
router.post("/courier/:courierName", webhookLimiter, async (req: Request, res: Response) => {
    const { courierName } = req.params;
    const { awb, status } = req.body;
    const providerName = courierName.toUpperCase();

    // Idempotency check
    const idKey = await createIdempotencyKey(`${awb}_${status}`, "DELIVERY_EVENT");
    if (!idKey) return res.sendStatus(200);

    try {
        const shipment = await prisma.shipment.update({
            where: { awb },
            data: {
                status,
                lastEventAt: new Date(),
                courierName: providerName
            },
            include: { order: true }
        });

        if (shipment.order) {
            let newOrderStatus: any = shipment.order.orderStatus;
            if (status === "DELIVERED") newOrderStatus = "DELIVERED";
            if (status === "RTO") newOrderStatus = "RTO";

            await prisma.order.update({
                where: { id: shipment.orderId },
                data: {
                    orderStatus: newOrderStatus,
                    logisticsStatus: status
                }
            });
        }

        await createAuditLog({
            action: "WEBHOOK_RECEIVED",
            metadata: { provider: providerName, awb, status }
        });
        res.sendStatus(200);
    } catch (error) {
        console.error(`Webhook error (${providerName}):`, error);
        res.status(404).json({ error: "Shipment not found" });
    }
});

// FENDEX Webhook (Legacy legacy/backward compat)
router.post("/fendex", webhookLimiter, async (req: Request, res: Response) => {
    // Forwarding to the new dynamic route format for processing
    req.params.courierName = "FENDEX";
    const { awb, status } = req.body;

    // Signature check for FENDEX (as per old logic)
    const signature = req.headers["x-fendex-signature"] as string;
    const payload = JSON.stringify(req.body);
    if (!verifyFendexSignature(payload, signature)) {
        return res.status(401).json({ error: "Invalid signature" });
    }

    // The dynamic router expects raw status names that match our enums
    // (Existing fendex logic used ShipmentStatus which we'll assume is aligned)
    return (router as any).handle(req, res); // Redirect internally or just duplicate logic
});

// RAZORPAY Webhook
router.post("/razorpay", webhookLimiter, async (req: Request, res: Response) => {
    const signature = req.headers["x-razorpay-signature"] as string;
    const payload = JSON.stringify(req.body);

    if (!verifyRazorpayWebhook(payload, signature)) {
        await createAuditLog({ action: "WEBHOOK_AUTH_FAIL", metadata: { provider: "RAZORPAY", ip: req.ip } });
        return res.status(401).json({ error: "Invalid signature" });
    }

    const event = req.body.event;
    const data = req.body.payload;

    if (event === "payment.captured") {
        const rpOrderId = data.payment.entity.order_id;
        const rpPaymentId = data.payment.entity.id;

        const idKey = await createIdempotencyKey(rpPaymentId, "PAYMENT_CAPTURED");
        if (!idKey) return res.sendStatus(200);

        await prisma.order.update({
            where: { razorpayOrderId: rpOrderId },
            data: { paymentStatus: "PAID", razorpayPaymentId: rpPaymentId }
        });
    }

    if (event === "refund.processed") {
        const rpPaymentId = data.refund.entity.payment_id;
        const refundAmount = data.refund.entity.amount / 100;

        const idKey = await createIdempotencyKey(data.refund.entity.id, "REFUND_EVENT");
        if (!idKey) return res.sendStatus(200);

        // Reversal logic needed here
    }

    await createAuditLog({ action: "WEBHOOK_RECEIVED", metadata: { provider: "RAZORPAY", event } });
    res.sendStatus(200);
});

export default router;
