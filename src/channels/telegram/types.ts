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
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string }>;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: TelegramUser;
  message?: { chat?: { id: number }; message_id?: number };
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
};
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
