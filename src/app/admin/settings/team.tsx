import { isStaffRole, type StaffRole } from "@/core/auth/roles";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { deleteTeamMemberFn, saveTeamMemberFn, teamFn } from "@/app/admin/team.functions";
import {
  createStaffInviteFn,
  revokeStaffInviteFn,
  staffInvitesFn,
} from "@/app/admin/team-invite.functions";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

type Member = Awaited<ReturnType<typeof teamFn>>[number];
type Invite = Awaited<ReturnType<typeof staffInvitesFn>>[number];

/**
 * Команда магазина: владелец заводит менеджеров (заказы, товары, рассылки) и
 * пользователей «только просмотр» (бухгалтер, аналитик). Логин уникален на
 * платформе, пароль от 8 символов; все действия подписываются логином в
 * истории заказа.
 */
export function TeamCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ url: string; until: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(shop.locale), { dateStyle: "medium" });
  const reload = () =>
    Promise.all([teamFn(), staffInvitesFn()])
      .then(([m, i]) => {
        setMembers(m);
        setInvites(i);
      })
      .catch((e) => setError(e));
  useEffect(() => {
    void reload();
  }, []);
  const save = useAction(async (f: FormData) => {
    await saveTeamMemberFn({
      data: {
        username: String(f.get("username")),
        name: String(f.get("name") || ""),
        role: isStaffRole(f.get("role")) ? (f.get("role") as StaffRole) : "manager",
        password: String(f.get("password") || "") || undefined,
      },
    });
    setEditing(null);
    await reload();
  });
  const invite = useAction(async (f: FormData) => {
    const r = await createStaffInviteFn({
      data: {
        role: isStaffRole(f.get("role")) ? (f.get("role") as StaffRole) : "manager",
        name: String(f.get("name") || "") || undefined,
      },
    });
    setLink({ url: r.link, until: r.expiresAt });
    setCopied(false);
    await reload();
  });
  const revoke = useAction(async (id: string) => {
    if (!confirm(t("settings.team.inviteRevokeConfirm"))) return;
    await revokeStaffInviteFn({ data: { id } });
    await reload();
  });
  const remove = useAction(async (username: string) => {
    if (!confirm(t("settings.team.deleteConfirm", { username }))) return;
    await deleteTeamMemberFn({ data: { username } });
    await reload();
  });
  const current = editing === "new" ? null : editing;
  return (
    <Card
      title={t("settings.team.title")}
      actions={
        <div className="flex gap-2">
          <button
            className="btn-secondary text-xs"
            onClick={() => {
              setInviting(true);
              setLink(null);
            }}
          >
            {t("settings.team.invite")}
          </button>
          <button className="btn-secondary text-xs" onClick={() => setEditing("new")}>
            {t("settings.team.add")}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("settings.team.intro")}</p>
      <ErrorBox error={error ?? remove.error ?? revoke.error} />
      {members === null ? (
        <p className="text-sm text-muted">{t("settings.team.loading")}</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted">{t("settings.team.onlyYou")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {members.map((m) => (
            <li key={m.username} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <span className="font-medium">{m.username}</span>
                {m.name && <span className="text-muted"> · {m.name}</span>}{" "}
                <Badge tone={m.role === "manager" ? "accent" : "neutral"}>
                  {t(`role.${m.role}`)}
                </Badge>
              </div>
              <div className="flex shrink-0 gap-1">
                <Link to="/admin/log" search={{ who: m.username }} className="btn-ghost text-xs">
                  {t("settings.team.journal")}
                </Link>
                <button className="btn-ghost text-xs" onClick={() => setEditing(m)}>
                  {t("common.edit")}
                </button>
                <button
                  className="btn-ghost text-xs text-danger"
                  disabled={remove.busy}
                  onClick={() => void remove.run(m.username).catch(() => {})}
                >
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {invites.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-sm font-medium">{t("settings.team.invitePending")}</h4>
          <ul className="divide-y divide-line text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Badge tone="neutral">{t(`role.${i.role}`)}</Badge>
                  {i.name && <span className="text-muted"> · {i.name}</span>}
                  <span className="text-muted">
                    {" "}
                    · {t("settings.team.inviteUntil", { date: fmtDate(i.expiresAt) })}
                  </span>
                </div>
                <button
                  className="btn-ghost shrink-0 text-xs text-danger"
                  disabled={revoke.busy}
                  onClick={() => void revoke.run(i.id).catch(() => {})}
                >
                  {t("settings.team.inviteRevoke")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {inviting && (
        <form
          className="mt-4 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void invite.run(new FormData(e.currentTarget)).catch(() => {});
          }}
        >
          <p className="text-sm text-muted sm:col-span-2">{t("settings.team.inviteIntro")}</p>
          <Field label={t("settings.team.name")}>
            <input className="input" name="name" maxLength={80} />
          </Field>
          <Field label={t("settings.team.role")}>
            <select className="input" name="role" defaultValue="manager">
              <option value="admin">{t("settings.team.roleAdmin")}</option>
              <option value="manager">{t("settings.team.roleManager")}</option>
              <option value="viewer">{t("settings.team.roleViewer")}</option>
              <option value="accountant">{t("settings.team.roleAccountant")}</option>
            </select>
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={invite.busy}>
              {t("settings.team.inviteCreate")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setInviting(false)}>
              {t("common.cancel")}
            </button>
          </div>
          {link && (
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm">
                {t("settings.team.inviteLinkOnce", { date: fmtDate(link.until) })}
              </p>
              <input
                className="input"
                readOnly
                value={link.url}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(link.url)
                    .then(() => setCopied(true))
                    .catch(() => undefined);
                }}
              >
                {copied ? t("settings.team.inviteCopied") : t("settings.team.inviteCopy")}
              </button>
            </div>
          )}
          <div className="sm:col-span-2">
            <ErrorBox error={invite.error} />
          </div>
        </form>
      )}
      {editing !== null && (
        <form
          key={current?.username ?? "new"}
          className="mt-4 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget)).catch(() => {});
          }}
        >
          <Field label={t("settings.team.username")} hint={t("settings.team.usernameHint")}>
            <input
              className="input"
              name="username"
              defaultValue={current?.username ?? ""}
              readOnly={Boolean(current)}
              required
              autoComplete="off"
            />
          </Field>
          <Field label={t("settings.team.name")}>
            <input
              className="input"
              name="name"
              defaultValue={current?.name ?? ""}
              maxLength={80}
            />
          </Field>
          <Field label={t("settings.team.role")}>
            <select className="input" name="role" defaultValue={current?.role ?? "manager"}>
              <option value="admin">{t("settings.team.roleAdmin")}</option>
              <option value="manager">{t("settings.team.roleManager")}</option>
              <option value="viewer">{t("settings.team.roleViewer")}</option>
              <option value="accountant">{t("settings.team.roleAccountant")}</option>
            </select>
          </Field>
          <Field
            label={current ? t("settings.team.newPassword") : t("settings.team.password")}
            hint={t("settings.team.passwordHint")}
          >
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required={!current}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
          <div className="sm:col-span-2">
            <ErrorBox error={save.error} />
          </div>
        </form>
      )}
    </Card>
  );
}
