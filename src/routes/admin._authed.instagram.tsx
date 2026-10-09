import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { instagramFn } from "@/app/admin/instagram.functions";
import { Card, Empty, PageTitle } from "@/app/ui";
import {
  useAdminI18n,
  type Editing,
  scrollToEl,
  ruleAnchor,
  type EditTarget,
} from "@/app/admin/instagram/shared";
import { RuleForm } from "@/app/admin/instagram/rule-form";
import { RulesCard } from "@/app/admin/instagram/rules";
import { CatchupCard } from "@/app/admin/instagram/catchup";
import { FallbackJournal } from "@/app/admin/instagram/fallback-journal";

export const Route = createFileRoute("/admin/_authed/instagram")({
  loader: () => instagramFn(),
  component: InstagramPage,
});

function InstagramPage() {
  const data = Route.useLoaderData();
  const { t } = useAdminI18n();
  const [editing, setEditing] = useState<Editing | null>(null);
  // Несохранённые изменения в открытой форме: RuleForm обновляет при каждой отрисовке.
  const dirty = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const editingKey = editing?.key;

  // Форма открывается над списком правил — прокручиваем к ней (и на ПК, и на телефоне).
  useEffect(() => {
    if (editingKey !== undefined) scrollToEl(formRef.current, "start");
  }, [editingKey]);

  // После «Сохранить» — к сохранённому правилу в списке и короткая подсветка.
  useEffect(() => {
    if (!highlight) return;
    scrollToEl(document.getElementById(ruleAnchor(highlight)), "center");
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [highlight]);

  /** Отбросить несохранённое в открытой форме — только с согласия продавца. */
  const mayDiscard = () => !dirty.current || confirm(t("instagram.form.discardConfirm"));
  const open = (next: EditTarget) => {
    if (editing?.kind === "edit" && next.kind === "edit" && next.rule.id === editing.rule.id) {
      // То же правило уже открыто — только вернуть форму в поле зрения.
      scrollToEl(formRef.current, "start");
      return;
    }
    if (editing && !mayDiscard()) return;
    dirty.current = false;
    setEditing({ ...next, key: ++seq.current });
  };
  const close = () => {
    if (!mayDiscard()) return;
    dirty.current = false;
    setEditing(null);
  };

  if (!data.configured)
    return (
      <>
        <PageTitle title="Instagram" />
        <Card>
          <Empty>{t("instagram.notConfigured")}</Empty>
        </Card>
      </>
    );
  if (data.accounts.length === 0)
    return (
      <>
        <PageTitle title="Instagram" subtitle={t("instagram.subtitleShort")} />
        <Card>
          <Empty>
            {t("instagram.notConnected")}{" "}
            <Link to="/admin/settings" className="underline">
              {t("instagram.connectInSettings")}
            </Link>
          </Empty>
        </Card>
      </>
    );
  return (
    <>
      <PageTitle title="Instagram" subtitle={t("instagram.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {editing !== null && (
            <div ref={formRef} className="scroll-mt-4">
              <RuleForm
                key={editing.key}
                data={data}
                editing={editing}
                dirtyRef={dirty}
                onClose={close}
                onSaved={(id) => {
                  dirty.current = false;
                  setEditing(null);
                  setHighlight(id);
                }}
              />
            </div>
          )}
          <RulesCard
            data={data}
            highlight={highlight}
            onNew={() => open({ kind: "new" })}
            onEdit={(rule) => open({ kind: "edit", rule })}
            onCopy={(rule) => open({ kind: "copy", rule })}
          />
        </div>
        <div className="space-y-4">
          <CatchupCard data={data} />
          <FallbackJournal rows={data.fallbackSends} />
        </div>
      </div>
    </>
  );
}
