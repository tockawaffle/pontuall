import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client";

function createPrisma() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error("DATABASE_URL is not set");
    }

    const adapter = new PrismaPg({ connectionString: url });
    return new PrismaClient({ adapter });
}

/** Shared Prisma client for Better Auth and internal sidecar routes. */
export const prisma = createPrisma();
