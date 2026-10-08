import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  createWhatsAppTemplateFn,
  setExcludedPhonesFn,
  syncWhatsAppTemplatesFn,
} from "@/app/admin/broadcasts.functions";
import { type AdminT } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, Field, useAction } from "@/app/ui";
import { LANGUAGES, TEMPLATE_STATUS, type Template, type WhatsApp, useT } from "./shared";

export function TemplatesCard({ wa }: { wa: WhatsApp }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(wa.accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("ru");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("MARKETING");
  const [body, setBody] = useState("");
  type Btn = { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; value: string };
  const [buttons, setButtons] = useState<Btn[]>([]);
  const setBtn = (i: number, patch: Partial<Btn>) =>
    setButtons((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const sync = useAction(async () => {
    for (const a of wa.accounts) await syncWhatsAppTemplatesFn({ data: { accountId: a.id } });
    await router.invalidate();
  });
  const create = useAction(async () => {
    await createWhatsAppTemplateFn({
      data: {
        accountId,
        name,
        language,
        category,
        body,
        buttons: buttons
          .filter((b) => b.text.trim())
          .map((b) =>
            b.type === "URL"
              ? { type: "URL" as const, text: b.text, url: b.value }
              : b.type === "PHONE_NUMBER"
                ? { type: "PHONE_NUMBER" as const, text: b.text, phone: b.value }
                : { type: "QUICK_REPLY" as const, text: b.text },
          ),
      },
    });
    setName("");
    setBody("");
    setButtons([]);
    setOpen(false);
    await router.invalidate();
  });

  return (
    <Card
      title={t("broadcasts.templates.title")}
      actions={
        wa.accounts.length > 0 ? (
          <div className="flex gap-2">
            <button
              className="btn-secondary text-xs"
              disabled={sync.busy}
              onClick={() => void sync.run().catch(() => {})}
            >
              {sync.busy ? t("broadcasts.templates.syncing") : t("broadcasts.templates.sync")}
            </button>
            <button className="btn-secondary text-xs" onClick={() => setOpen((v) => !v)}>
              {open ? t("common.hide") : t("broadcasts.templates.new")}
            </button>
          </div>
        ) : undefined
      }
    >
      <p className="mb-3 text-sm text-muted">
        {t("broadcasts.templates.introBefore")} <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>
        {t("broadcasts.templates.introAfter")}
      </p>
      {open && (
        <form
          className="mb-4 space-y-3 rounded-md border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create.run().catch(() => {});
          }}
        >
          {wa.accounts.length > 1 && (
            <Field label={t("broadcasts.templates.account")}>
              <select
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {wa.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("broadcasts.templates.name")} hint={t("broadcasts.templates.nameHint")}>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="new_arrivals"
                required
              />
            </Field>
            <Field label={t("broadcasts.templates.language")}>
              <select
                className="input"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("broadcasts.templates.category")}
              hint={t("broadcasts.templates.categoryHint")}
            >
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value as "UTILITY" | "MARKETING")}
              >
                <option value="MARKETING">MARKETING</option>
                <option value="UTILITY">UTILITY</option>
              </select>
            </Field>
          </div>
          <Field label={t("broadcasts.templates.body")} hint={`${body.length} / 1024`}>
            <textarea
              className="input min-h-24"
              value={body}
              maxLength={1024}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("broadcasts.templates.bodyPlaceholder")}
              required
            />
          </Field>
          <Field
            label={t("broadcasts.templates.buttons")}
            hint={t("broadcasts.templates.buttonsHint")}
          >
            <div className="space-y-2">
              {buttons.map((b, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr_auto]">
                  <select
                    className="input"
                    value={b.type}
                    onChange={(e) => setBtn(i, { type: e.target.value as Btn["type"], value: "" })}
                  >
                    <option value="QUICK_REPLY">{t("broadcasts.templates.btnQuick")}</option>
                    <option value="URL">{t("broadcasts.templates.btnUrl")}</option>
                    <option value="PHONE_NUMBER">{t("broadcasts.templates.btnPhone")}</option>
                  </select>
                  <input
                    className="input"
                    maxLength={25}
                    placeholder={t("broadcasts.templates.btnText")}
                    value={b.text}
                    onChange={(e) => setBtn(i, { text: e.target.value })}
                  />
                  {b.type !== "QUICK_REPLY" ? (
                    <input
                      className="input"
                      placeholder={b.type === "URL" ? "https://…" : "+7…"}
                      value={b.value}
                      onChange={(e) => setBtn(i, { value: e.target.value })}
                    />
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className="btn-ghost text-xs text-danger"
                    onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              {buttons.length < 3 && (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() =>
                    setButtons((bs) => [...bs, { type: "QUICK_REPLY", text: "", value: "" }])
                  }
                >
                  {t("broadcasts.templates.addButton")}
                </button>
              )}
            </div>
          </Field>
          <button className="btn-primary" disabled={create.busy}>
            {create.busy ? t("broadcasts.templates.submitting") : t("broadcasts.templates.submit")}
          </button>
          <ErrorBox error={create.error} />
        </form>
      )}
      {wa.templates.length === 0 ? (
        <Empty>{t("broadcasts.templates.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {wa.templates.map((tpl) => (
            <TemplateRow key={tpl.id} t={t} tpl={tpl} />
          ))}
        </ul>
      )}
      <ErrorBox error={sync.error} />
    </Card>
  );
}

function TemplateRow({ t, tpl }: { t: AdminT; tpl: Template }) {
  const st = TEMPLATE_STATUS[tpl.status];
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{tpl.name}</span>
        <span className="text-xs text-muted">{tpl.language}</span>
        <Badge tone={st?.tone ?? "neutral"}>{st ? t(st.label) : tpl.status}</Badge>
        <span className="text-xs text-muted">{tpl.category}</span>
      </div>
      {tpl.body && (
        <p className="mt-1 line-clamp-2 text-sm text-muted whitespace-pre-wrap">{tpl.body}</p>
      )}
      {tpl.reason && <p className="mt-1 text-xs text-danger">Meta: {tpl.reason}</p>}
    </li>
  );
}

export function ExcludedPhonesCard({ phones }: { phones: string }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(phones);
  const save = useAction(async () => {
    const r = await setExcludedPhonesFn({ data: { phones: value } });
    setValue(r.phones);
    await router.invalidate();
  });
  return (
    <Card title={t("broadcasts.excluded.title")}>
      <p className="mb-3 text-sm text-muted">{t("broadcasts.excluded.intro")}</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <textarea
          className="input min-h-20"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="77001234567, 77007654321"
        />
        <button className="btn-secondary" disabled={save.busy}>
          {t("common.save")}
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}
