import prisma from "../prisma";

export const createAuditLog = async (data: {
    actorId?: string;
    actorRole?: string;
    action: string;
    targetId?: string;
    metadata?: any;
}) => {
    try {
        const log = await prisma.auditLog.create({
            data: {
                actorId: data.actorId,
                actorRole: data.actorRole,
                action: data.action,
                targetId: data.targetId,
                metadata: data.metadata || {}
            }
        });
        return log;
    } catch (error) {
        console.error("Audit Log Failure:", error);
        // Do not throw to avoid breaking main business logic
    }
};

export const createIdempotencyKey = async (key: string, scope: string) => {
    try {
        const iKey = await prisma.idempotencyKey.create({
            data: { key, scope }
        });
        return iKey;
    } catch (error: any) {
        if (error.code === "P2002") {
            return null; // Already exists
        }
        throw error;
    }
};
