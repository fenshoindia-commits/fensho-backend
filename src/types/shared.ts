import { z } from "zod";

export const RoleEnum = z.enum(["ADMIN", "SELLER", "BUYER"]);
export const SellerTypeEnum = z.enum(["PAN_ONLY", "GST"]);
export const KycStatusEnum = z.enum(["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED"]);

export const PaymentMethodEnum = z.enum(["COD", "ONLINE"]);
export const PaymentStatusEnum = z.enum(["PENDING", "PAID", "FAILED"]);
export const OrderStatusEnum = z.enum(["PLACED", "SHIPPED", "DELIVERED", "RTO", "CANCELLED"]);
export const RiskEventTypeEnum = z.enum(["CANCEL", "RTO", "DELIVERED", "COD_BLOCK", "MANUAL_OVERRIDE"]);
export const LedgerEntryTypeEnum = z.enum(["SALE", "COMMISSION", "TDS", "HOLD", "RELEASE", "PAYOUT"]);


export const LoginSchema = z.object({
    mobile: z.string().min(10, "Mobile number must be at least 10 digits"),
    role: RoleEnum.default("BUYER").optional(),
});

export const VerifyOtpSchema = z.object({
    mobile: z.string().min(10),
    code: z.string().length(6),
});

export const SellerKycSchema = z.object({
    storeName: z.string().min(3),
    type: SellerTypeEnum,
    panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format"),
    gstNumber: z.string().optional(), // Required if type is GST, validated in logic
    bankAccount: z.string().min(9),
    ifscCode: z.string().length(11),
    holderName: z.string().min(3),
    state: z.string().min(2),
});

export const ProductCreateSchema = z.object({
    title: z.string().min(3),
    description: z.string().optional(),
    price: z.number().positive(),
    imageUrl: z.string().url().optional(),
});

export const BuyerProfileSchema = z.object({
    name: z.string().min(3).optional(),
});

export const AddressSchema = z.object({
    line1: z.string().min(3),
    city: z.string().min(2),
    state: z.string().min(2),
    pincode: z.string().length(6),
});

export const OrderCreateSchema = z.object({
    items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
    })),
    addressId: z.string(),
    paymentMethod: PaymentMethodEnum.default("ONLINE"),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export type SellerKycInput = z.infer<typeof SellerKycSchema>;
export type ProductCreateInput = z.infer<typeof ProductCreateSchema>;
export type BuyerProfileInput = z.infer<typeof BuyerProfileSchema>;
export type AddressInput = z.infer<typeof AddressSchema>;
export type OrderCreateInput = z.infer<typeof OrderCreateSchema>;
