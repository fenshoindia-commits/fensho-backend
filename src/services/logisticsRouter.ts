import prisma from "../prisma";
import { getCourierProvider } from "./courierProviders";
import { createAuditLog } from "./auditService";

export class LogisticsRouterService {
    static async routeOrder(orderId: string) {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                items: { include: { product: { include: { sellerProfile: true } } } },
                buyer: true
            }
        });

        if (!order) throw new Error("Order not found");

        const originState = order.items[0]?.product?.sellerProfile?.state || "";
        const destState = order.buyerState || "";
        const isSameState = originState === destState;
        const isPanSeller = order.items[0]?.product?.sellerProfile?.type === "PAN_ONLY";
        const sellerGst = order.items[0]?.product?.sellerProfile?.type === "GST";

        // Fetch active courier configs, sorted by priority
        let courierConfigs = await prisma.courierConfig.findMany({
            where: { isActive: true },
            orderBy: { priority: "asc" }
        });

        // Selection priority:
        // 1) If same state and PAN seller -> Prefer FENDEX
        if (isPanSeller && isSameState) {
            const fendexIndex = courierConfigs.findIndex(c => c.name === "FENDEX");
            if (fendexIndex > -1) {
                const [fendex] = courierConfigs.splice(fendexIndex, 1);
                courierConfigs.unshift(fendex);
            }
        }

        // 2) If interstate and GST -> Any active courier by priority
        // (Default sorting already handles priority)

        let success = false;
        let lastError = "";

        for (const config of courierConfigs) {
            // Check COD support
            if (order.paymentMethod === "COD") {
                if (!config.supportsCOD) continue;
                if (config.maxCodAmount && Number(order.totalAmount) > config.maxCodAmount) continue;
            }

            const provider = getCourierProvider(config.name);

            try {
                const isServiceable = await provider.checkServiceability(originState, destState);
                if (!isServiceable) continue;

                const result = await provider.createShipment(order, config);

                // Update Order and Shipment
                await prisma.$transaction([
                    prisma.order.update({
                        where: { id: orderId },
                        data: {
                            orderStatus: "SHIPPED",
                            trackingAwb: result.awb,
                            logisticsStatus: result.status
                        }
                    }),
                    prisma.shipment.upsert({
                        where: { orderId },
                        create: {
                            orderId,
                            courierName: config.name,
                            courierCost: result.cost,
                            courierPriority: config.priority,
                            awb: result.awb,
                            status: result.status,
                            originState,
                            destState
                        },
                        update: {
                            courierName: config.name,
                            courierCost: result.cost,
                            awb: result.awb,
                            status: result.status
                        }
                    })
                ]);

                await createAuditLog({
                    action: "LOGISTICS_ROUTED",
                    targetId: orderId,
                    metadata: { courier: config.name, awb: result.awb }
                });

                success = true;
                break;
            } catch (err: any) {
                lastError = err.message || "Failed to create shipment";
                continue;
            }
        }

        if (!success) {
            await prisma.order.update({
                where: { id: orderId },
                data: { orderStatus: "PENDING_LOGISTICS" }
            });

            await prisma.shipment.upsert({
                where: { orderId },
                create: {
                    orderId,
                    status: "FAILED",
                    failureReason: lastError || "All couriers failed"
                },
                update: {
                    status: "FAILED",
                    failureReason: lastError || "All couriers failed"
                }
            });

            await createAuditLog({
                action: "LOGISTICS_FAILURE",
                targetId: orderId,
                metadata: { error: lastError || "All attempts failed" }
            });
        }
    }
}
