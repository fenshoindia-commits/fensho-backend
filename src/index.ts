import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import path from "path";
import helmet from "helmet";
import routes from "./routes";
import { errorHandler } from "./middleware/security";
import prisma from "./prisma";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "http://localhost:5173",
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "../uploads")));

app.get("/", (req, res) => {
    res.json({
        message: "FENSHO Backend API",
        status: "Running",
        environment: process.env.NODE_ENV || "production",
        endpoints: {
            health: "/health",
            api: "/api"
        }
    });
});

app.get("/health", async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: "ok", db: "connected", version: "1.0.0" });
    } catch (e) {
        res.status(503).json({ status: "error", db: "disconnected" });
    }
});

app.use("/api", routes);

app.use(errorHandler);

app.listen(PORT, "0.0.0.0" as any, () => {
    console.log(`Server running on port ${PORT}`);
});
