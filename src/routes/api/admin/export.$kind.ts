import { createFileRoute } from "@tanstack/react-router";

/** Выгрузка в Excel (CSV с BOM и «;») — файл отдаётся прямо из сессии админа. */
export const Route = createFileRoute("/api/admin/export/$kind")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAdmin, requireAdminModule } = await import("@/app/auth/guards.server");
        let ctx;
        try {
          // Каталог выгружает любой продавец — это его данные для импорта обратно; заказы и покупатели — модуль.
          ctx =
            params.kind === "products"
              ? await requireAdmin()
              : await requireAdminModule("excel_export");
        } catch {
          return new Response("unauthorized", { status: 401 });
        }
        const url = new URL(request.url);
        const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
        const { ordersCsv, customersCsv, productsCsv } = await import("@/core/export/export");
        let result: { csv: string; count: number };
        let name: string;
        if (params.kind === "orders") {
          const from = day(url.searchParams.get("from"));
          const to = day(url.searchParams.get("to"));
          result = await ordersCsv(ctx, { from, to });
          name = `orders${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`;
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
