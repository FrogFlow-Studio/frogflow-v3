import { beforeEach, describe, expect, it, vi } from "vitest";
import { roleAllows, type AdminRole } from "@/core/auth/roles";
import { UserError } from "@/core/i18n/user-error";

/**
 * Маршрут /api/admin/export/<вид>: всё с контактами покупателей (полный
 * архив, покупатели, заказы) отдаётся только владельцу и менеджеру. Гварды
 * подменены — роль и модуль задаются тестом, проверка роли настоящая.
 */
let role: AdminRole | null = "owner";
let moduleOn = true;
let profitOn = true;
const CTX = { tenant: { id: "shop-1" } };

// Как настоящие гварды: бухгалтеру закрыто всё, кроме requireAdminFinance.
const denyAccountant = () => {
  if (role === "accountant") throw new UserError("err.auth.accountantDenied", "бухгалтер");
};
let ordersArgs: unknown[] = [];

vi.mock("@/app/auth/guards.server", () => ({
  requireAdmin: async () => {
    if (!role) throw new Error("Unauthorized");
    denyAccountant();
    return CTX;
  },
  requireAdminFinance: async () => {
    if (!role) throw new Error("Unauthorized");
    return {
      ctx: { tenant: { ...CTX.tenant, modules: { excel_export: moduleOn, profit: profitOn } } },
      accountant: role === "accountant",
    };
  },
  requireAdminModule: async (_key: string, min?: AdminRole) => {
    if (!role) throw new Error("Unauthorized");
    denyAccountant();
    if (min && !roleAllows(role, min)) throw new UserError("err.auth.viewOnly", "нет прав");
    if (!moduleOn) throw new UserError("err.auth.moduleOff", "модуль");
    return CTX;
  },
}));
vi.mock("@/core/export/export", async (orig) => ({
  ...(await orig<typeof import("@/core/export/export")>()),
  allDataZip: async () => ({ zip: Buffer.from("PK"), counts: {} }),
  customersCsv: async () => ({ csv: "c", count: 1 }),
  ordersCsv: async (...a: unknown[]) => {
    ordersArgs = a;
    return { csv: "o", count: 1 };
  },
  productsCsv: async () => ({ csv: "p", count: 1 }),
}));
let analyticsArgs: unknown[] = [];
vi.mock("@/core/analytics/export.server", () => ({
  analyticsCsv: async (...a: unknown[]) => {
    analyticsArgs = a;
    return { csv: "an", count: 1 };
  },
}));
let profitArgs: unknown[] = [];
vi.mock("@/core/profit/report", () => ({
  profitReport: async (...a: unknown[]) => {
    profitArgs = a;
    return {
      products: [],
      otherCurrencies: [],
      revenue: 0,
      unknown: { items: 0, revenue: 0 },
      margin: null,
      currency: "KZT",
    };
  },
}));
vi.mock("@/core/export/payments", () => ({
  paymentsCsv: async () => ({ csv: "pay", count: 1 }),
}));

const { Route } = await import("@/routes/api/admin/export.$kind");
type Get = (a: { request: Request; params: { kind: string } }) => Promise<Response>;
const GET = (Route.options as unknown as { server: { handlers: { GET: Get } } }).server.handlers
  .GET;
const get = (kind: string) =>
  GET({ request: new Request(`http://x/api/admin/export/${kind}`), params: { kind } });

beforeEach(() => {
  role = "owner";
  profitOn = true;
  moduleOn = true;
  ordersArgs = [];
});

describe("выгрузки с контактами покупателей: кто скачивает", () => {
  it("владелец и менеджер получают ZIP", async () => {
    for (const r of ["owner", "manager"] as const) {
      role = r;
      const res = await get("all");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("роль «просмотр» получает 403, без сессии — 401, без модуля — 403", async () => {
    role = "viewer";
    expect((await get("all")).status).toBe(403);
    role = null;
    expect((await get("all")).status).toBe(401);
    role = "owner";
    moduleOn = false;
    expect((await get("all")).status).toBe(403);
  });

  it("контакты покупателей выгружают только владелец и менеджер", async () => {
    for (const kind of ["customers", "orders"]) {
      role = "viewer";
      expect((await get(kind)).status).toBe(403);
      for (const r of ["owner", "manager"] as const) {
        role = r;
        expect((await get(kind)).status).toBe(200);
      }
    }
  });

  it("каталог без контактов выгружает и роль «просмотр», даже без модуля", async () => {
    role = "viewer";
    moduleOn = false;
    expect((await get("products")).status).toBe(200);
  });
});

describe("бухгалтер: выгрузка заказов без контактов, остальное закрыто", () => {
  it("заказы — 200, и выгрузка просит убрать контакты", async () => {
    role = "accountant";
    expect((await get("orders")).status).toBe(200);
    expect(ordersArgs[1]).toMatchObject({ noContacts: true });
  });

  it("владельцу и менеджеру заказы — с контактами", async () => {
    for (const r of ["owner", "manager"] as const) {
      role = r;
      expect((await get("orders")).status).toBe(200);
      expect(ordersArgs[1]).toMatchObject({ noContacts: false });
    }
  });

  it("полный архив, покупатели и каталог бухгалтеру — 403", async () => {
    role = "accountant";
    for (const kind of ["all", "customers", "products"]) expect((await get(kind)).status).toBe(403);
  });

  it("без модуля выгрузки бухгалтеру и заказы — 403", async () => {
    role = "accountant";
    moduleOn = false;
    expect((await get("orders")).status).toBe(403);
  });
});

describe("оплаты: без контактов покупателей, любая роль раздела финансов", () => {
  it("бухгалтер, просмотр, менеджер и владелец — 200", async () => {
    for (const r of ["accountant", "viewer", "manager", "owner"] as const) {
      role = r;
      const res = await get("payments");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("payments");
    }
  });

  it("без модуля выгрузки — 403, без сессии — 401", async () => {
    moduleOn = false;
    expect((await get("payments")).status).toBe(403);
    role = null;
    expect((await get("payments")).status).toBe(401);
  });
});

describe("аналитика: как её страница, любая роль раздела финансов, без модуля", () => {
  it("бухгалтер, просмотр, менеджер и владелец — 200, даже без модуля выгрузки", async () => {
    moduleOn = false;
    for (const r of ["accountant", "viewer", "manager", "owner"] as const) {
      role = r;
      for (const kind of ["analytics", "analytics-products"]) {
        const res = await get(kind);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-disposition")).toContain(kind);
        expect(res.headers.get("content-type")).toContain("text/csv");
      }
    }
  });

  it("вид и период доходят до выгрузки; лишний период — 30 дней", async () => {
    const one = (kind: string, q: string) =>
      GET({
        request: new Request(`http://x/api/admin/export/${kind}?days=${q}`),
        params: { kind },
      });
    await one("analytics", "90");
    expect(analyticsArgs.slice(1, 3)).toEqual(["daily", 90]);
    await one("analytics-products", "7");
    expect(analyticsArgs.slice(1, 3)).toEqual(["products", 7]);
    await one("analytics", "365");
    expect(analyticsArgs[2]).toBe(30);
  });

  it("без сессии — 401", async () => {
    role = null;
    expect((await get("analytics")).status).toBe(401);
  });
});

describe("прибыль по товарам: как аналитика, но нужен модуль profit", () => {
  it("любая роль раздела финансов получает CSV, период доходит до отчёта", async () => {
    moduleOn = false; // модуль выгрузки заказов не нужен
    for (const r of ["accountant", "viewer", "manager", "owner"] as const) {
      role = r;
      const res = await GET({
        request: new Request("http://x/api/admin/export/profit?days=90"),
        params: { kind: "profit" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("profit-90d");
      expect(res.headers.get("content-type")).toContain("text/csv");
      expect(profitArgs[1]).toBe(90);
    }
  });

  it("без модуля profit — 403, без сессии — 401", async () => {
    profitOn = false;
    expect((await get("profit")).status).toBe(403);
    profitOn = true;
    role = null;
    expect((await get("profit")).status).toBe(401);
  });
});
