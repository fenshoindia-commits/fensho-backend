import prisma from "../prisma";

export const calculateVolumetricWeight = (length: number, width: number, height: number): number => {
    return (length * width * height) / 5000;
};

export const getShippingClass = (actualWeight: number, volumetricWeight: number): string => {
    const finalWeight = Math.max(actualWeight, volumetricWeight);
    if (finalWeight < 500) return "LIGHT";
    if (finalWeight <= 5000) return "MEDIUM";
    return "HEAVY";
};

export const updateProductWithShippingClass = async (productId: string) => {
    const product = await prisma.product.findUnique({
        where: { id: productId }
    });

    if (!product || !product.weightGrams || !product.lengthCm || !product.widthCm || !product.heightCm) {
        return;
    }

    const volumetricWeight = calculateVolumetricWeight(
        product.lengthCm,
        product.widthCm,
        product.heightCm
    );

    const shippingClass = getShippingClass(product.weightGrams, volumetricWeight);

    await prisma.product.update({
        where: { id: productId },
        data: {
            volumetricWeight,
            shippingClass
        }
    });
};
