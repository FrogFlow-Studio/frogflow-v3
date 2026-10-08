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
  /** Когда отправлено, секунды Unix. */
  date?: number;
  chat: { id: number; type?: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  contact?: { phone_number: string };
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_size?: number }>;
  /** Голосовое сообщение (Ogg/Opus), «кружок» (mp4), видео и аудиофайл — ответ на задание. */
  voice?: { file_id: string; file_size?: number };
  video_note?: { file_id: string; file_size?: number };
  video?: { file_id: string; file_name?: string; file_size?: number };
  audio?: { file_id: string; file_name?: string; file_size?: number };
  /** Часть альбома: у всех сообщений одного альбома одинаковый. */
  media_group_id?: string;
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
  /** Изменение участника в чате, где бот — администратор (канал курса). */
  chat_member?: {
    chat: { id: number; username?: string };
    new_chat_member?: {
      status?: string;
      user?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
    };
    invite_link?: { invite_link?: string };
  };
};

export type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
};
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
