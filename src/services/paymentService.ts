import Razorpay from "razorpay";
import crypto from "crypto";

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_mock",
    key_secret: process.env.RAZORPAY_KEY_SECRET || "mock_secret"
});

export const createRazorpayOrder = async (orderId: string, amount: number) => {
    const options = {
        amount: Math.round(amount * 100), // in paise
        currency: "INR",
        receipt: orderId,
    };

    try {
        const order = await razorpay.orders.create(options);
        return order;
    } catch (error) {
        console.error("Razorpay Order Error:", error);
        throw new Error("Failed to create Razorpay order");
    }
};

export const verifyRazorpaySignature = (orderId: string, paymentId: string, signature: string) => {
    const secret = process.env.RAZORPAY_KEY_SECRET || "mock_secret";
    const body = orderId + "|" + paymentId;
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    return expected === signature;
};

export const verifyRazorpayWebhook = (payload: string, signature: string) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "mock_secret";
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return expected === signature;
};

export const processRazorpayRefund = async (paymentId: string, amount?: number) => {
    try {
        const refund = await razorpay.payments.refund(paymentId, {
            amount: amount ? Math.round(amount * 100) : undefined
        });
        return refund;
    } catch (error) {
        console.error("Razorpay Refund Error:", error);
        throw new Error("Failed to process refund");
    }
};
