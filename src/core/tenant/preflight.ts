import { moduleDef, type ModuleKey } from "@/core/modules/registry";
import type { SubscriptionState } from "@/core/billing/subscription";
import type { Tenant } from "@/core/tenant/types";
import { isConsultantVertical } from "@/core/verticals/registry";

/**
 * Предполётная проверка перед переводом клиента на v2 — чистая часть:
 * что блокирует переезд, что стоит поправить, что напомнить. Сбор входных
 * данных (getMe, счётчики) — в app/operator/migration.server.ts.
 */
export type PreflightLevel = "ok" | "info" | "warn" | "block";
export type PreflightCheck = { key: string; level: PreflightLevel; title: string; detail: string };
export type Preflight = { ready: boolean; checks: PreflightCheck[] };

export type PreflightInput = {
  modulesOn: ModuleKey[];
  tokenPresent: boolean;
  /** null — не проверяли (токена нет). */
  tokenOk: boolean | null;
  botUsername: string | null;
  paymentMethods: number;
  /**
   * Продаёт ли клиент в боте. false — только консультант (BOVI): заказов нет,
   * реквизиты не нужны, а задать их можно лишь в админке v2 — после переезда.
   * Не передано — продаёт.
   */
  sells?: boolean;
  products: number;
  adminLogin: boolean;
  /** Адрес деплоя v1 — напоминание поставить его крон на паузу. */
  appUrl: string | null;
  /** Аккаунты Zernio клиента, записанные ещё и у другого клиента. */
  zernioConflicts?: string[];
  /*
   * Необязательные поля: не передано — пункт не проверяется (старые вызовы
   * и тесты не меняют смысл).
   */
  /** Сколько продавцов жмут «подтвердить»: admin_chat_id плюс владелец из карточки. */
  sellerChats?: number;
  /** Заказы в `delivering`: выдачу вёл v1, v2 такие не подхватит. */
  deliveringOrders?: number;
  /** Активные цифровые товары без единого файла — покупатель их не купит. */
  unsellableProducts?: number;
  /** settings.slug; null — не задан (ссылки «Магазин» и документов будут с UUID). */
  slug?: string | null;
  /** Состояние подписки и включена ли политика «приостановить». */
  subscription?: { state: SubscriptionState; suspend: boolean };
  /** Заказы из Instagram и WhatsApp за последние 30 дней. */
  channelOrders30d?: number;
  /**
   * Консультант в Instagram или WhatsApp: переписка — весь его продукт, поэтому
   * Zernio обязателен и без заказов из каналов (BOVI заказов не принимает).
   */
  consultantDm?: boolean;
  /** Сколько аккаунтов Zernio записано клиенту (settings.zernio.account_ids). */
  zernioAccounts?: number;
  /** Записан ли клиенту профиль Zernio: вебхук v2 получает события только профилей клиентов v2. */
  zernioProfile?: boolean;
  /** Задан ли ZERNIO_WEBHOOK_SECRET: без него вебхук v2 отвечает 503 и «Привязать» не срабатывает. */
  zernioSecret?: boolean;
  /** Почта платформы: настроен ли SMTP и шлёт ли клиенту что-то письмом (сайт, копия выдачи). */
  mail?: { configured: boolean; needed: boolean };
  /**
   * Теги сторис: в v1 (story_product_tags), в v2 (app_settings), сколько
   * допишет перенос при переключении и сколько не влезет в предел v2 —
   * посчитано тем же слиянием, что и при переключении (mergeLegacyStoryTags).
   */
  storyTags?: { v1: number; v2: number; add: number; dropped: number; max: number };
  /**
   * Консультант по прайсу (BOVI): включён ли флаг, сколько позиций в прайсе
   * консультанта (consultant_catalog_json, общая с v1 строка) и свежий ли курс.
   */
  pricelist?: { enabled: boolean; items: number; rateFresh: boolean };
  /**
   * Баллы лояльности: у скольких покупателей они есть и сколько заказов за
   * 30 дней было не в валюте магазина — у таких покупателей цена балла
   * меняется (в v1 балл списывался в валюте заказа, в v2 — в валюте магазина).
   */
  loyalty?: { holders: number; foreignOrders30d: number; shopCurrency: string };
  /**
   * Онлайн-школа (модуль courses): сколько курсов, у скольких нет ни одного
   * урока и у скольких не подключён закрытый канал.
   */
  school?: {
    courses: number;
    withoutLessons: number;
    withoutChannel: number;
    /** Эфиры потоков без ссылки, которые ещё не закончились; нет поля — 0. */
    liveNoLink?: number;
  };
  /** Минимальная сумма заказа магазина (core/cart/min-order); не задана — поле не передаётся. */
  minOrder?: { amount: number; currency: string };
  /**
   * Комиссия платформы (core/commission): общий выключатель, ставка тарифа клиента
   * (null — тариф не назначен или договорной), дата начала `ГГГГ-ММ-ДД` и порог в месяц.
   */
  commission?: { enabled: boolean; rate: number | null; start: string; free: number };
};

/**
 * Продаёт ли клиент в боте: магазин любой ниши — да; консультант (BOVI) — только
 * с курсами или с продажей в боте, переписке или на сайте и активными товарами.
 * Модуль магазина у консультанта v1 часто включён, а товаров нет: продавать
 * нечего, реквизиты ему до переезда не нужны (BOVI, 06.10).
 */
export function sellsInBot(t: Pick<Tenant, "vertical" | "modules">, products: number): boolean {
  if (!isConsultantVertical(t.vertical)) return true;
  const m = t.modules;
  if (m.courses) return true;
  return products > 0 && Boolean(m.shop || m.dm_shop || m.wa_shop || m.web_storefront);
}

export function evaluatePreflight(i: PreflightInput): Preflight {
  const checks: PreflightCheck[] = [];
  const planned = i.modulesOn.filter((k) => moduleDef(k).status === "planned");
  checks.push(
    planned.length
      ? {
          key: "modules",
          level: "block",
          title: "Не все модули перенесены",
          detail: `Включены, но в v2 их ещё нет: ${planned.map((k) => moduleDef(k).title).join(", ")}. Выключите их или подождите переноса.`,
        }
      : {
          key: "modules",
          level: "ok",
          title: "Модули перенесены",
          detail: `Все ${i.modulesOn.length} включённых модулей есть в v2.`,
        },
  );
  if (!i.tokenPresent)
    checks.push({
      key: "token",
      level: "block",
      title: "Нет токена бота",
      detail: "Подключите Telegram токеном из проекта Vercel клиента (TELEGRAM_BOT_TOKEN).",
    });
  else if (i.tokenOk === false)
    checks.push({
      key: "token",
      level: "block",
      title: "Токен не отвечает",
      detail: "Telegram отклонил токен (getMe). Проверьте, что он не отозван в BotFather.",
    });
  else
    checks.push({
      key: "token",
      level: "ok",
      title: `Бот отвечает${i.botUsername ? ` — @${i.botUsername}` : ""}`,
      detail: "Токен проверен через getMe.",
    });
  checks.push(
    i.sells === false && i.paymentMethods === 0
      ? {
          key: "payments",
          level: "info",
          title: "Оплата в боте не нужна",
          detail:
            "Клиент — консультант без заказов в боте. Начнёт продавать — реквизиты по странам добавит в админке v2.",
        }
      : i.paymentMethods > 0 || i.modulesOn.includes("robokassa")
        ? {
            key: "payments",
            level: "ok",
            title: "Оплата настроена",
            detail: i.paymentMethods > 0 ? `Реквизитов: ${i.paymentMethods}.` : "Robokassa.",
          }
        : {
            key: "payments",
            level: "block",
            title: "Нет реквизитов оплаты",
            detail:
              "Покупатель не сможет оформить заказ. Реквизиты по странам — в админке продавца.",
          },
  );
  checks.push(
    i.products > 0
      ? {
          key: "products",
          level: "ok",
          title: "Товары есть",
          detail: `Активных товаров: ${i.products}.`,
        }
      : i.sells === false
        ? {
            key: "products",
            level: "info",
            title: "Товары не нужны",
            detail:
              "Консультант без продаж в боте: покупателям отвечает консультант, каталога в боте нет.",
          }
        : {
            key: "products",
            level: "warn",
            title: "Нет активных товаров",
            detail: "Каталог в боте будет пустым.",
          },
  );
  checks.push(
    i.adminLogin
      ? {
          key: "admin",
          level: "ok",
          title: "Логин продавца задан",
          detail: "Продавец сможет войти в админку v2.",
        }
      : {
          key: "admin",
          level: "block",
          title: "Нет логина продавца",
          detail:
            "Задайте логин и пароль в карточке: после паузы проекта v1 его админка пропадёт, и продавцу некуда будет войти.",
        },
  );
  if (i.sellerChats !== undefined && i.sellerChats === 0)
    checks.push({
      key: "seller_chat",
      level: "block",
      title: i.sells === false ? "Некому передавать диалоги" : "Некому подтверждать заказы",
      detail:
        i.sells === false
          ? "Не задан ни Telegram-id владельца в карточке, ни admin_chat_id в настройках магазина: вопросы, на которые консультант не ответит, некому будет передать."
          : "Не задан ни Telegram-id владельца в карточке, ни admin_chat_id в настройках магазина: чеки придут, но нажать «Подтвердить и выдать» будет некому.",
    });
  if (i.deliveringOrders)
    checks.push({
      key: "delivering",
      level: "block",
      title: "Идёт выдача заказов в v1",
      detail: `Заказов в выдаче: ${i.deliveringOrders}. Их ведёт крон v1, v2 такие не подхватит. Дождитесь окончания или выдайте вручную.`,
    });
  if (i.unsellableProducts)
    checks.push({
      key: "files",
      level: "warn",
      title: "Цифровые товары без файлов",
      detail: `Активных товаров без файлов: ${i.unsellableProducts}. В v2 их нельзя купить, пока продавец не загрузит материалы.`,
    });
  if (i.slug === null)
    checks.push({
      key: "slug",
      level: "warn",
      title: "Нет короткого адреса",
      detail:
        "Задайте его в «Адресах»: иначе ссылки на магазин и документы будут с длинным id клиента.",
    });
  if (i.subscription?.state === "grace_over")
    checks.push({
      key: "subscription",
      level: i.subscription.suspend ? "block" : "warn",
      title: "Подписка просрочена",
      detail: i.subscription.suspend
        ? "Политика «приостановить»: первый же ночной крон v2 выключит бота. Продлите подписку или смените политику."
        : "Бот продолжит работать, продавец будет получать предупреждения об оплате.",
    });
  if (i.zernioConflicts?.length)
    checks.push({
      key: "zernio",
      level: "block",
      title: "Аккаунт Zernio числится у двух клиентов",
      detail: `Ключ Zernio один на платформу, и события аккаунта ${i.zernioConflicts.join(", ")} не уйдут никому. Уберите его у одного из клиентов.`,
    });
  const dmNeeded = Boolean(i.channelOrders30d) || i.consultantDm === true;
  if (dmNeeded && i.zernioAccounts === 0)
    checks.push({
      key: "zernio_accounts",
      level: "block",
      title: "Instagram и WhatsApp не подключены",
      detail: i.channelOrders30d
        ? `За 30 дней заказов из Instagram и WhatsApp: ${i.channelOrders30d}, а аккаунтов Zernio у клиента в v2 нет. После переезда эти покупатели останутся без ответа. Подключите аккаунты в карточке клиента.`
        : "Консультант отвечает в Instagram или WhatsApp, а аккаунтов Zernio у клиента в v2 нет. После переезда консультант замолчит. Подключите аккаунты в карточке клиента.",
    });
  if (i.zernioAccounts && i.zernioProfile === false)
    checks.push({
      key: "zernio_profile",
      level: "block",
      title: "Нет профиля Zernio",
      detail:
        "Аккаунты Instagram/WhatsApp записаны, а профиль нет. Вебхук v2 получает события только профилей клиентов v2, поэтому после переезда сообщения этих аккаунтов не дойдут. В карточке клиента нажмите «Привязать профиль v1».",
    });
  if (dmNeeded && i.zernioSecret === false)
    checks.push({
      key: "zernio_secret",
      level: "block",
      title: "Не задан секрет вебхука Zernio",
      detail:
        "В окружении платформы нет ZERNIO_WEBHOOK_SECRET: вебхук v2 не принимает события и «Привязать» его не создаст, Instagram и WhatsApp после переезда замолчат. Задайте переменную в Vercel и сделайте Redeploy.",
    });
  if (i.mail && i.mail.needed && !i.mail.configured)
    checks.push({
      key: "mail",
      level: "warn",
      title: "Почта платформы не настроена",
      detail:
        "У клиента есть сайт или покупатели оставляют почту для копии материалов, а SMTP платформы не задан: писем не будет. Материалы останутся на странице заказа.",
    });
  const tags = i.storyTags;
  if (tags?.dropped)
    checks.push({
      key: "story_tags",
      level: "warn",
      title: "Теги сторис не влезут",
      detail: `В v1 тегов: ${tags.v1}, в v2 уже: ${tags.v2}, а v2 хранит не больше ${tags.max}. Свои теги v2 останутся все; из v1 при переключении перенесутся ${tags.add} самых новых, ${tags.dropped} не перенесутся. Если они нужны, продавцу стоит освободить место в v2 заранее.`,
    });
  else if (tags?.add)
    checks.push({
      key: "story_tags",
      level: "info",
      title: "Теги сторис перенесутся при переключении",
      detail: `Из v1 допишутся ${tags.add} (всего в v1: ${tags.v1}, в v2 уже: ${tags.v2}). После переключения проверьте их в админке.`,
    });
  const pl = i.pricelist;
  if (pl?.enabled && pl.items === 0)
    checks.push({
      key: "pricelist",
      level: "block",
      title: "Консультант по прайсу без прайса",
      detail:
        "Флаг «Консультант по прайсу» включён, а прайс консультанта пуст: на любой вопрос о товаре консультант ответит, что ничего нет. Загрузите выгрузку 1С на странице продавца «Прайс консультанта» или выключите флаг.",
    });
  else if (pl && !pl.enabled && pl.items > 0)
    checks.push({
      key: "pricelist",
      level: "warn",
      title: "У клиента прайс консультанта v1, а флаг выключен",
      detail: `В прайсе консультанта ${pl.items} позиций (консультант BOVI v1). Без флага «Консультант по прайсу» консультант v2 будет отвечать по товарам магазина, а не по прайсу. Включите флаг в карточке клиента.`,
    });
  else if (pl?.enabled && !pl.rateFresh)
    checks.push({
      key: "pricelist",
      level: "warn",
      title: "Курс рубля для консультанта устарел",
      detail:
        "Курса нет или он старше трёх дней: покупателям из России консультант не назовёт цены в рублях. Проверьте источник курса у оператора или введите курс вручную у продавца.",
    });
  const loyalty = i.loyalty;
  if (loyalty?.holders && loyalty.foreignOrders30d)
    checks.push({
      key: "loyalty",
      level: "warn",
      title: "Цена балла изменится у покупателей в другой валюте",
      detail: `Баллы есть у ${loyalty.holders} покупателей, за 30 дней ${loyalty.foreignOrders30d} заказов не в ${loyalty.shopCurrency}. В v1 балл списывался 1 к 1 в валюте заказа, в v2 — 1 балл = 1 ${loyalty.shopCurrency} по курсу; балансы не пересчитываются. Предупредите продавца до переезда.`,
    });
  const school = i.school;
  if (school && school.courses === 0)
    checks.push({
      key: "school",
      level: "info",
      title: "В школе нет курсов",
      detail:
        "Модуль «Курсы» включён, а курса ещё нет. Продавец создаёт его в «Товары» → «Новый курс».",
    });
  else if (school?.withoutLessons)
    checks.push({
      key: "school",
      level: "warn",
      title: "Курсы без уроков",
      detail: `Курсов без единого урока: ${school.withoutLessons} из ${school.courses}. Покупатель оплатит такой курс и ничего не получит; добавьте уроки или скройте товар.`,
    });
  else if (school?.withoutChannel)
    checks.push({
      key: "school",
      level: "info",
      title: "У курсов нет закрытого канала",
      detail: `Курсов без канала: ${school.withoutChannel} из ${school.courses}. Ученики получат уроки только в боте; канал подключается в карточке курса (бот магазина — администратор с правом приглашать).`,
    });
  if (school?.liveNoLink)
    checks.push({
      key: "school_live",
      level: "info",
      title: "Эфиры потоков без ссылки",
      detail: `Эфиров без ссылки: ${school.liveNoLink}. Ученики видят их в расписании, а ссылка открывается им за 15 минут до начала и пока эфир идёт; напоминания за сутки и за час шлёт крон course-lives покупателям из Telegram. Добавьте ссылку в карточке курса, блок «Эфиры потока».`,
    });
  if (i.minOrder)
    checks.push({
      key: "min_order",
      level: "info",
      title: "Задана минимальная сумма заказа",
      detail: `Минимум ${i.minOrder.amount} ${i.minOrder.currency}: бот, сайт и Instagram/WhatsApp в v2 не дадут оформить заказ меньше и подскажут, сколько добрать. v1 этой настройки не знает, поэтому проверьте, что она нужна продавцу и что цены товаров её не нарушают; счёт ссылкой, выставленный продавцом, минимум не проверяет.`,
    });
  const commission = i.commission;
  const free = commission ? commission.free.toLocaleString("ru").replace(/\s/g, " ") : "";
  if (commission)
    checks.push(
      commission.rate === null
        ? {
            key: "commission",
            level: "info",
            title: "Комиссия платформы не начисляется",
            detail:
              "У клиента не назначен тариф или условия договорные: комиссии с витрины и маркета не будет, пока не назначен тариф.",
          }
        : commission.enabled
          ? {
              key: "commission",
              level: "info",
              title: `Комиссия платформы ${commission.rate} % с ${commission.start}`,
              detail: `С оплаченных заказов витрины и маркета в тенге сверх ${free} ₸ в месяц, отдельной строкой в счёте за подписку. Заказы из бота (в том числе Mini App), Instagram и WhatsApp комиссии не несут. Предупредите продавца до переезда: страница «Комиссия» в его админке покажет, сколько набежало.`,
            }
          : {
              key: "commission",
              level: "info",
              title: "Комиссия платформы пока выключена",
              detail: `Ставка тарифа клиента ${commission.rate} % с оплаченных заказов витрины и маркета в тенге сверх ${free} ₸ в месяц, начало ${commission.start}. Общий выключатель выключен, поэтому сейчас ничего не начисляется и в счёт не попадает; включает оператор по слову Якова, продавца о ставке лучше предупредить заранее.`,
            },
    );
  if (i.appUrl)
    checks.push({
      key: "v1",
      level: "info",
      title: "Остановите крон v1 после переезда",
      detail: `Деплой ${i.appUrl} каждую минуту (крон broadcast) ставит вебхук обратно. Сразу после переключения поставьте его проект Vercel на паузу.`,
    });
  return { ready: !checks.some((c) => c.level === "block"), checks };
}

export function preflightBlockers(p: Preflight): string[] {
  return p.checks.filter((c) => c.level === "block").map((c) => c.title);
}

/**
 * Откат трогает Telegram (кнопку меню) только у клиента, которого v2
 * действительно обслуживала: «v1» у клиента, который и так на v1, не должен
 * сбрасывать меню его живого бота.
 */
export function releasesTelegramOnSwitch(
  prev: string | null | undefined,
  next: "v1" | "v2" | null | undefined,
): boolean {
  return prev === "v2" && next === "v1";
}
