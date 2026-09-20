import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { customersFn, setBlockedFn } from "@/app/admin/admin.functions";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/customers")({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => customersFn({ data: deps }),
  component: CustomersPage,
});

function CustomersPage() {
  const rows = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [query, setQuery] = useState(q ?? "");
  const block = useAction(async (r: (typeof rows)[number], blocked: boolean) => {
    await setBlockedFn({
      data: { telegramId: r.telegram_id, blocked, username: r.username, firstName: r.first_name },
    });
    await router.invalidate();
  });
  return (
    <>
      <PageTitle title="Покупатели" subtitle={`${rows.length} показано`} />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: "/admin/customers", search: { q: query || undefined } });
        }}
      >
        <input
          className="input w-64"
          placeholder="Имя, @username, телефон"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-secondary">Найти</button>
      </form>
      <ErrorBox error={block.error} />
      {rows.length === 0 ? (
        <Empty>Никого не найдено.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Покупатель</th>
                <th>Канал</th>
                <th>Контакты</th>
                <th className="text-right">Баллы</th>
                <th>С нами</th>
                {shop.modules.blocked && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_key}>
                  <td>
                    {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}{" "}
                    {r.username && <span className="text-muted">@{r.username}</span>}
                    {r.blocked && <Badge tone="danger">заблокирован</Badge>}
                  </td>
                  <td className="text-muted">{r.platform}</td>
                  <td className="text-muted">
                    {[r.contact_phone, r.email].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="text-right tabular-nums">{r.loyalty_points}</td>
                  <td className="text-muted">{new Date(r.created_at).toLocaleDateString("ru")}</td>
                  {shop.modules.blocked && (
                    <td className="text-right">
                      <button
                        className={`btn-ghost text-xs ${r.blocked ? "" : "text-danger"}`}
                        disabled={block.busy || r.platform !== "telegram"}
                        onClick={() => void block.run(r, !r.blocked).catch(() => {})}
                      >
                        {r.blocked ? "Разблокировать" : "Заблокировать"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
