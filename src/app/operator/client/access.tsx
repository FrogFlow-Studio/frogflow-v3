/** Карточка клиента у оператора: модули, вход продавца в админку, адрес магазина. */
import { SHOP_SLUG_PATTERN } from "@/core/tenant/slug";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  setAddressingFn,
  setAdminCredentialsFn,
  setModuleFn,
} from "@/app/operator/clients.functions";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/core/modules/registry";
import { Badge, Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import type { C } from "./types";

export function ModulesCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const toggle = useAction(async (key: ModuleKey, on: boolean) => {
    await setModuleFn({ data: { botId: c.id, key, on } });
    await onDone();
  });
  const groups = new Map<string, ModuleKey[]>();
  for (const k of MODULE_KEYS) {
    const g = moduleDef(k).group;
    groups.set(g, [...(groups.get(g) ?? []), k]);
  }
  return (
    <Card
      title="Модули"
      actions={<span className="text-xs text-muted">{c.modulesOn} включено</span>}
    >
      <ErrorBox error={toggle.error} />
      <div className="space-y-4">
        {[...groups.entries()].map(([group, keys]) => (
          <div key={group}>
            <div className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
              {group}
            </div>
            <div className="divide-y divide-line">
              {keys.map((k) => {
                const d = moduleDef(k);
                const planned = d.status !== "available";
                return (
                  <div key={k} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={planned ? "text-muted" : ""}>{d.title}</span>
                        {planned && <Badge>в разработке</Badge>}
                        {d.price === null && !planned && <Badge tone="accent">в пакете</Badge>}
                      </div>
                      <div className="text-xs text-muted">
                        {d.price ? `${d.price.toLocaleString("ru")} ₸` : ""}
                        {d.requires?.length
                          ? ` · требует: ${d.requires.map((r) => moduleDef(r as ModuleKey).title).join(", ")}`
                          : ""}
                      </div>
                    </div>
                    <Switch
                      checked={c.modules[k]}
                      disabled={planned || toggle.busy}
                      onChange={(on) => void toggle.run(k, on).catch(() => {})}
                      label={d.title}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AdminAccessCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const set = useAction(async (username: string, password: string) => {
    await setAdminCredentialsFn({ data: { botId: c.id, username, password } });
    await onDone();
  });
  const [done, setDone] = useState(false);
  return (
    <Card
      title="Вход продавца в админку"
      actions={
        c.adminUsername ? <Badge tone="ok">{c.adminUsername}</Badge> : <Badge>не настроен</Badge>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void set
            .run(String(f.get("username")).trim().toLowerCase(), String(f.get("password")))
            .then(() => setDone(true))
            .catch(() => {});
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Логин">
            <input
              className="input"
              name="username"
              defaultValue={c.adminUsername ?? c.slug ?? ""}
              pattern="[a-z0-9_.\-]{3,40}"
              required
            />
          </Field>
          <Field label="Новый пароль">
            <input
              className="input"
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-secondary" disabled={set.busy}>
            Сохранить
          </button>
          {done && (
            <span className="text-xs text-ok">
              {c.servedBy === "v2"
                ? "Сохранено. Вход: "
                : "Сохранено для v2. Вход после переезда: "}
            </span>
          )}
          <Link to="/admin/login" className="text-xs text-accent hover:underline">
            /admin/login
          </Link>
        </div>
        {c.servedBy !== "v2" && (
          <p className="text-xs text-muted">
            Клиента пока обслуживает v1: вход в /admin v2 для него закрыт до переезда, и этот пароль
            заработает только после переключения на v2. В прежнюю панель продавец входит по
            ADMIN_USERNAME и ADMIN_PASSWORD из проекта клиента в Vercel, отсюда они не меняются.
          </p>
        )}
        <ErrorBox error={set.error} />
      </form>
    </Card>
  );
}

export function AddressingCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const addr = useAction(async (slug: string, hosts: string[]) => {
    await setAddressingFn({ data: { botId: c.id, slug: slug || null, hosts } });
    await onDone();
  });
  return (
    <Card title="Адреса">
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const hosts = String(f.get("hosts"))
            .split(/[\s,]+/)
            .map((h) => h.trim())
            .filter(Boolean);
          void addr.run(String(f.get("slug")).trim().toLowerCase(), hosts).catch(() => {});
        }}
      >
        <Field label="Короткий адрес" hint="Витрина и Mini App: /s/<адрес>">
          <input
            className="input"
            name="slug"
            defaultValue={c.slug ?? ""}
            pattern={SHOP_SLUG_PATTERN}
          />
        </Field>
        <Field label="Свои домены" hint="Через запятую. DNS домена должен смотреть на платформу.">
          <input
            className="input"
            name="hosts"
            defaultValue={c.hosts.join(", ")}
            placeholder="shop.example.kz"
          />
        </Field>
        <button className="btn-secondary" disabled={addr.busy}>
          Сохранить адреса
        </button>
        <ErrorBox error={addr.error} />
      </form>
    </Card>
  );
}
