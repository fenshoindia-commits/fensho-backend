import { Router } from "express";
import authRoutes from "./auth";
import sellerRoutes from "./seller";
import productRoutes from "./products";
import buyerRoutes from "./buyer";
import adminRoutes from "./admin";
import webhookRoutes from "./webhooks";

const router = Router();

router.use("/auth", authRoutes);
router.use("/seller", sellerRoutes);
router.use("/products", productRoutes);
router.use("/buyer", buyerRoutes);
router.use("/admin", adminRoutes);
router.use("/webhooks", webhookRoutes);

export default router;
