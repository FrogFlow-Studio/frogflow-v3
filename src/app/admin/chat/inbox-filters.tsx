import { HelpTip } from "@/app/admin/help-panel";
import { type AdminT } from "@/app/i18n/admin";
import { type InboxFilter } from "@/core/inbox/inbox";

const CHANNELS = [
  ["all", "chat.chAll"],
  ["telegram", "Telegram"],
  ["instagram", "Instagram"],
  ["whatsapp", "WhatsApp"],
] as const;

export function InboxFilters({
  t,
  filter,
  counts,
  search,
  onSearch,
  onChange,
}: {
  t: AdminT;
  filter: InboxFilter;
  counts: { open: number; mine: number; unassigned: number; unread: number };
  search: string;
  onSearch: (q: string) => void;
  onChange: (f: InboxFilter) => void;
}) {
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm ${active ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2/60"}`;
  const statuses = [
    ["open", `${t("chat.fOpen")} · ${counts.open}`],
    ["closed", t("chat.fClosed")],
    ["all", t("chat.fAll")],
  ] as const;
  const whos = [
    ["all", t("chat.wAll")],
    ["mine", `${t("chat.wMine")} · ${counts.mine}`],
    ["none", `${t("chat.wNone")} · ${counts.unassigned}`],
  ] as const;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {statuses.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={tab(filter.status === v)}
            onClick={() => onChange({ ...filter, status: v })}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={Boolean(filter.unread)}
        className={tab(Boolean(filter.unread))}
        onClick={() => onChange({ ...filter, unread: !filter.unread })}
      >
        {`${t("chat.fUnread")} · ${counts.unread}`}
      </button>
      <span className="self-center">
        <HelpTip article="chat" anchor="filters" />
      </span>
      <input
        type="search"
        className="input h-8 w-48 py-0 text-sm"
        value={search}
        placeholder={t("chat.search")}
        aria-label={t("chat.search")}
        onChange={(e) => onSearch(e.target.value)}
      />
      <select
        className="input h-8 w-auto py-0 text-sm"
        value={filter.who}
        onChange={(e) => onChange({ ...filter, who: e.target.value as InboxFilter["who"] })}
      >
        {whos.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <select
        className="input h-8 w-auto py-0 text-sm"
        value={filter.channel}
        onChange={(e) => onChange({ ...filter, channel: e.target.value as InboxFilter["channel"] })}
      >
        {CHANNELS.map(([v, label]) => (
          <option key={v} value={v}>
            {v === "all" ? t(label as "chat.chAll") : label}
          </option>
        ))}
      </select>
    </div>
  );
}
