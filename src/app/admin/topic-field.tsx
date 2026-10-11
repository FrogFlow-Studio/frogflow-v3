import { HelpTip } from "@/app/admin/help-panel";
import { useState } from "react";
import type { AdminT } from "@/app/i18n/admin";
import type { BulkAction } from "@/core/catalog/bulk";
import { cleanTopics, topicKey } from "@/core/catalog/topics";
import { Field } from "@/app/ui";

/** Сколько подсказок тем показывать под полем. */
const SUGGEST_MAX = 12;

/**
 * Поле «Тема» в форме товара (core/catalog/topics): темы через запятую и
 * подсказки из уже заведённых в магазине, чтобы не плодить «1 сентября» и
 * «1-е сентября». Значение уходит в форму полем `topics`.
 */
export function TopicField({
  t,
  initial,
  existing,
}: {
  t: AdminT;
  initial: readonly string[];
  existing: readonly string[];
}) {
  const [value, setValue] = useState(initial.join(", "));
  const have = new Set(cleanTopics(value).map(topicKey));
  const tail = topicKey(value.split(",").pop() ?? "");
  const offer = existing
    .filter((x) => !have.has(topicKey(x)) && (!tail || topicKey(x).includes(tail)))
    .slice(0, SUGGEST_MAX);
  const pick = (topic: string) => {
    // Недописанный хвост, из которого выбрали подсказку, заменяется ею.
    const parts = value.split(",");
    const done = tail && topicKey(topic).includes(tail) ? parts.slice(0, -1) : parts;
    setValue([...cleanTopics(done.join(",")), topic].join(", "));
  };
  return (
    <div>
      <Field
        label={t("product.topics")}
        hint={t("product.topicsHint")}
        help={<HelpTip article="products" anchor="name" />}
      >
        <input
          className="input"
          name="topics"
          value={value}
          placeholder={t("product.topicsPlaceholder")}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      {offer.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted">{t("product.topicsExisting")}</span>
          {offer.map((x) => (
            <button key={x} type="button" className="btn-ghost text-xs" onClick={() => pick(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Массовое назначение темы выбранным товарам (панель над списком). */
export function TopicBulk({
  t,
  existing,
  busy,
  onRun,
}: {
  t: AdminT;
  existing: readonly string[];
  busy: boolean;
  onRun: (a: BulkAction) => void;
}) {
  const [topic, setTopic] = useState("");
  const ok = cleanTopics([topic]).length > 0;
  return (
    <>
      <input
        className="input w-40"
        list="bulk-topics"
        placeholder={t("products.bulk.topic")}
        aria-label={t("products.bulk.topic")}
        value={topic}
        maxLength={60}
        onChange={(e) => setTopic(e.target.value)}
      />
      <datalist id="bulk-topics">
        {existing.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy || !ok}
        onClick={() => onRun({ kind: "topic", topic, mode: "add" })}
      >
        {t("products.bulk.topicAdd")}
      </button>
      <button
        type="button"
        className="btn-ghost"
        disabled={busy || !ok}
        onClick={() => onRun({ kind: "topic", topic, mode: "remove" })}
      >
        {t("products.bulk.topicRemove")}
      </button>
    </>
  );
}
