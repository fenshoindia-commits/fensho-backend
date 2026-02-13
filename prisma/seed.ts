import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    const adminMobile = "9999999999"; // Admin mobile

    const admin = await prisma.user.upsert({
        where: { mobile: adminMobile },
        update: {},
        create: {
            mobile: adminMobile,
            role: "ADMIN",
        },
    });

    console.log({ admin });
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
