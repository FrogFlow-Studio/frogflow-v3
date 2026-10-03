import { createFileRoute } from "@tanstack/react-router";

/** Выгрузка в Excel (CSV с BOM и «;») — файл отдаётся прямо из сессии админа. */
export const Route = createFileRoute("/api/admin/export/$kind")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAdmin, requireAdminModule, requireAdminFinance } =
          await import("@/app/auth/guards.server");
        const { CONTACTS_MIN_ROLE } = await import("@/core/export/export");
        let ctx;
        // Бухгалтер: только заказы и оплаты, без контактов покупателей.
        let noContacts = false;
        try {
          // Каталог выгружает любой продавец — это его данные для импорта обратно; заказы и покупатели — модуль.
          // Всё с контактами покупателей (архив, покупатели, заказы) — ещё и роль не ниже менеджера.
          const finance =
            params.kind === "orders" ||
            params.kind === "payments" ||
            params.kind === "analytics" ||
            params.kind === "analytics-products";
          const fin = finance ? await requireAdminFinance() : null;
          // «Оплаты» — без контактов покупателей: любая роль раздела финансов.
          const noModule = params.kind === "analytics" || params.kind === "analytics-products";
          // Аналитика — как её страница: любая роль раздела финансов, без модуля и без контактов.
          if (fin && noModule) {
            ctx = fin.ctx;
            noContacts = true;
          } else if (fin && (fin.accountant || params.kind === "payments")) {
            if (!fin.ctx.tenant.modules.excel_export)
              throw new (await import("@/core/i18n/user-error")).UserError(
                "err.auth.moduleOff",
                "Модуль «{module}» не подключён к вашему тарифу.",
                { module: "excel_export" },
              );
            ctx = fin.ctx;
            noContacts = true;
          } else
            ctx =
              params.kind === "products"
                ? await requireAdmin()
                : params.kind === "referrals"
                  ? // Отчёт «Рефералы» — модуль referral; имена покупателей — не ниже менеджера.
                    await requireAdminModule("referral", CONTACTS_MIN_ROLE)
                  : params.kind === "students"
                    ? // Ученики школы — модуль «Онлайн-школа», как их список; имена покупателей — не ниже менеджера.
                      await requireAdminModule("courses", CONTACTS_MIN_ROLE)
                    : await requireAdminModule("excel_export", CONTACTS_MIN_ROLE);
        } catch (e) {
          const { isUserError } = await import("@/core/i18n/user-error");
          // Вошёл, но роли или модуля не хватает — 403; нет сессии — 401.
          return isUserError(e)
            ? new Response("forbidden", { status: 403 })
            : new Response("unauthorized", { status: 401 });
        }
        const url = new URL(request.url);
        const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
        const { ordersCsv, customersCsv, productsCsv, allDataZip } =
          await import("@/core/export/export");
        if (params.kind === "all") {
          const { zip } = await allDataZip(ctx);
          const today = new Date().toISOString().slice(0, 10);
          return new Response(new Uint8Array(zip), {
            headers: {
              "content-type": "application/zip",
              "content-disposition": `attachment; filename="shop-data-${today}.zip"`,
              "cache-control": "no-store",
            },
          });
        }
        let result: { csv: string; count: number };
        let name: string;
        if (params.kind === "orders") {
          const from = day(url.searchParams.get("from"));
          const to = day(url.searchParams.get("to"));
          result = await ordersCsv(ctx, { from, to, noContacts });
          name = `orders${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`;
        } else if (params.kind === "payments") {
          const from = day(url.searchParams.get("from"));
          const to = day(url.searchParams.get("to"));
          const { paymentsCsv } = await import("@/core/export/payments");
          result = await paymentsCsv(ctx, { from, to });
          name = `payments${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`;
        } else if (params.kind === "analytics" || params.kind === "analytics-products") {
          const d = Number(url.searchParams.get("days"));
          const days = d === 7 || d === 90 ? d : 30;
          const { analyticsCsv } = await import("@/core/analytics/export.server");
          result = await analyticsCsv(
            ctx,
            params.kind === "analytics" ? "daily" : "products",
            days,
          );
          const today = new Date().toISOString().slice(0, 10);
          name = `${params.kind}-${days}d-${today}.csv`;
        } else if (params.kind === "students") {
          const id = url.searchParams.get("productId");
          const { studentsCsv } = await import("@/app/admin/students-export.server");
          result = await studentsCsv(ctx, id && /^[0-9a-f-]{36}$/i.test(id) ? id : null);
          name = "students.csv";
        } else if (params.kind === "referrals") {
          const { referralReportCsv } = await import("@/core/referrals/report");
          result = await referralReportCsv(ctx);
          name = "referrals.csv";
        } else if (params.kind === "customers") {
          result = await customersCsv(ctx);
          name = "customers.csv";
        } else if (params.kind === "products") {
          result = await productsCsv(ctx);
          name = "products.csv";
        } else return new Response("not found", { status: 404 });
        return new Response(result.csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${name}"`,
            "x-row-count": String(result.count),
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
