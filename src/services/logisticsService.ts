import prisma from "../prisma";

export enum ShipmentStatus {
    CREATED = "CREATED",
    PICKED = "PICKED",
    IN_TRANSIT = "IN_TRANSIT",
    DELIVERED = "DELIVERED",
    RTO = "RTO",
    CANCELLED = "CANCELLED"
}

export const createShipment = async (orderId: string, originState: string, destState: string) => {
    const isMock = process.env.FENDEX_MODE === "mock" || !process.env.FENDEX_API_KEY;
    const awb = `FDX${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const shipment = await prisma.shipment.create({
        data: {
            orderId,
            awb,
            status: ShipmentStatus.CREATED,
            originState,
            destState
        }
    });

    await prisma.order.update({
        where: { id: orderId },
        data: {
            trackingAwb: awb,
            logisticsStatus: ShipmentStatus.CREATED
        }
    });

    return shipment;
};

import crypto from "crypto";

export const verifyFendexSignature = (payload: string, signature: string) => {
    const secret = process.env.FENDEX_WEBHOOK_SECRET || "mock_secret";
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return expected === signature;
};
