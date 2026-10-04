import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

/**
 * Карточка настроек, которая подгружается отдельным куском, когда её показывают: страница
 * настроек самая тяжёлая в админке, а карточки за модулем или ролью (API, CRM, команда, выгрузка
 * данных, удаление магазина) нужны не каждому. Раздел-обёртка `SettingsSection` и якорь остаются
 * на месте: меняется только то, когда приходит код карточки. Сервер отдаёт карточку сразу в HTML.
 */
export function lazyCard<P extends object>(
  load: () => Promise<Record<string, unknown>>,
  name: string,
): ComponentType<P> {
  const Inner = lazy(async () => ({
    default: (await load())[name] as ComponentType<Record<string, unknown>>,
  }));
  return function LazyCard(props: P): ReactNode {
    return (
      <Suspense fallback={null}>
        <Inner {...(props as Record<string, unknown>)} />
      </Suspense>
    );
  };
}
