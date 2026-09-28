/** Подмножество Update из Bot API, которое реально читает адаптер. */
export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};

export type TelegramMessage = {
  message_id?: number;
  chat: { id: number; type?: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  contact?: { phone_number: string };
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_size?: number }>;
  /** Ответ свайпом: на какое сообщение (нужен текст уведомления с меткой покупателя). */
  reply_to_message?: { message_id?: number; text?: string; caption?: string };
  /** Оплата Telegram Stars прошла (счёт sendInvoice, валюта XTR). */
  successful_payment?: {
    currency: string;
    total_amount: number;
    invoice_payload: string;
    telegram_payment_charge_id?: string;
  };
};

export type TelegramPreCheckoutQuery = {
  id: string;
  from: TelegramUser;
  currency: string;
  total_amount: number;
  invoice_payload: string;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: TelegramUser;
  message?: { chat?: { id: number }; message_id?: number; reply_markup?: InlineKeyboard };
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  pre_checkout_query?: TelegramPreCheckoutQuery;
};

export type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
};
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
