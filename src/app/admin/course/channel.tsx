import { useState } from "react";
import { checkCourseChannelFn } from "@/app/admin/courses.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";

/** Закрытый канал курса. */

type ChannelCheck = Awaited<ReturnType<typeof checkCourseChannelFn>>;

/** Закрытый канал курса: id или @имя и проверка, что бот может приглашать. */
export function ChannelField({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: AdminT;
}) {
  const [checked, setChecked] = useState<ChannelCheck | null>(null);
  const check = useAction(async () => {
    setChecked(await checkCourseChannelFn({ data: { channel: value } }));
  });
  return (
    <div className="mb-3 space-y-1 text-sm">
      <label className="block text-xs text-muted" htmlFor="course-channel">
        {t("product.courseChannel")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="course-channel"
          className="input min-w-0 flex-1"
          placeholder="-1001234567890"
          maxLength={40}
          value={value}
          onChange={(e) => {
            setChecked(null);
            onChange(e.target.value.trim());
          }}
        />
        {value && (
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={check.busy}
            onClick={() => void check.run().catch(() => {})}
          >
            {t("product.courseChannelCheck")}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">{t("product.courseChannelHint")}</p>
      {checked && (
        <p className={`text-xs ${checked.ok ? "text-ok" : "text-warn"}`}>
          {checked.ok
            ? t("product.courseChannelOk", { title: checked.title })
            : t(`product.courseChannelErr.${checked.reason}`)}
        </p>
      )}
      <ErrorBox error={check.error} />
    </div>
  );
}
