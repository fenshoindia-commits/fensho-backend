export interface CourierResponse {
    awb: string;
    cost: number;
    status: string;
}

export interface CourierProvider {
    name: string;
    checkServiceability(origin: string, destination: string): Promise<boolean>;
    createShipment(order: any, config?: any): Promise<CourierResponse>;
    trackShipment(awb: string): Promise<{ status: string }>;
}

export class FenshoProvider implements CourierProvider {
    name = "FENSHO";
    async checkServiceability(origin: string, destination: string) { return true; }
    async createShipment(order: any) {
        return {
            awb: `FSN${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
            cost: 40,
            status: "CREATED"
        };
    }
    async trackShipment(awb: string) { return { status: "IN_TRANSIT" }; }
}

export class DelhiveryProvider implements CourierProvider {
    name = "DELHIVERY";
    async checkServiceability(origin: string, destination: string) { return true; }
    async createShipment(order: any) {
        return {
            awb: `DLV${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
            cost: 60,
            status: "CREATED"
        };
    }
    async trackShipment(awb: string) { return { status: "PICKED" }; }
}

export class XpressBeesProvider implements CourierProvider {
    name = "XPRESSBEES";
    async checkServiceability(origin: string, destination: string) { return true; }
    async createShipment(order: any) {
        return {
            awb: `XPB${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
            cost: 50,
            status: "CREATED"
        };
    }
    async trackShipment(awb: string) { return { status: "CREATED" }; }
}

export class ShadowfaxProvider implements CourierProvider {
    name = "SHADOWFAX";
    async checkServiceability(origin: string, destination: string) { return true; }
    async createShipment(order: any) {
        return {
            awb: `SFX${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
            cost: 55,
            status: "CREATED"
        };
    }
    async trackShipment(awb: string) { return { status: "CREATED" }; }
}

export class GenericApiProvider implements CourierProvider {
    name = "GENERIC";
    async checkServiceability(origin: string, destination: string) { return true; }
    async createShipment(order: any, config: any) {
        return {
            awb: `GEN${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
            cost: 70,
            status: "CREATED"
        };
    }
    async trackShipment(awb: string) { return { status: "CREATED" }; }
}

export const getCourierProvider = (name: string): CourierProvider => {
    switch (name.toUpperCase()) {
        case "FENSHO": return new FenshoProvider();
        case "DELHIVERY": return new DelhiveryProvider();
        case "XPRESSBEES": return new XpressBeesProvider();
        case "SHADOWFAX": return new ShadowfaxProvider();
        default: return new GenericApiProvider();
    }
};
