# Settings: channels

keywords: telegram, bot, token, botfather, instagram, direct, whatsapp, connect, autoresponder, bot pause, quick questions, ice breakers, quick purchase, channels
group: guide
order: 420

The "Channels" topic on the [Payment and settings](/admin/settings) page: connecting the Telegram bot, Instagram and WhatsApp, and how the bot behaves in chats. The owner and administrators connect and change them; others see the settings without the right to edit.

## Telegram bot {#telegram}

The shop's bot in Telegram. On the right of the card header is the status: "@name is working", a warning that the bot's link with the platform is not set up, or "not connected".

1. In Telegram, open @BotFather, send /newbot and come up with a name for the bot.
2. Copy the token like 123456789:AA… and paste it into the field.
3. Press "Connect". The platform checks the token and sets up the bot itself.

If you changed the bot, paste the new token and press "Replace". If the card says the bot's link with the platform is not set up, paste the same token again.

## Check and fix the bot {#telegram-check}

"Check the bot" goes point by point: whether the token works, whether messages reach the shop, whether the needed event types are on and whether the command menu is set. It changes nothing.

If something is wrong, "Fix it" appears: it sets up message delivery, event types and the command menu again. If Telegram refused, the reason is written under the button.

## Step-by-step connection {#channel-wizard}

A wizard for Instagram and WhatsApp (available if at least one of these modules is on). Three steps: "1. Sign in", "2. Connection check", "3. Test message".

1. Press "Sign in to Instagram" (or WhatsApp): a login page opens; sign in to the account and allow access, then you come back here.
2. After a minute, press "Check": the wizard checks the connection.
3. Write any message to the shop account from another account or number and press "Check" again. We send nothing, we wait for your message.

If something is wrong at a step, the wizard says what to do: for example, that the account is already connected to another shop or that the login dropped and needs to be repeated.

## Instagram and WhatsApp {#instagram-whatsapp}

The list of connected accounts and the buttons "Connect Instagram", "Connect WhatsApp", "Refresh list". Each account shows "working" or "needs reconnecting" (for example, the password was changed): then connect it again.

"Disconnect": the bot stops replying and writing in this account. Chats, orders and customers stay. To bring the account back, connect it again.

If the card says messenger connection is not set up on the platform, the buttons are inactive until the operator turns it on.

## Autoresponder · Instagram {#dbot-instagram}

How the bot behaves in Direct. All fields are saved with the "Save" button. If the shop works as an AI consultant without sales, most fields do not apply to it: its switch and pause are on the [consultant](/admin/consultant) page.

## Autoresponder switch {#dbot-enabled}

The switch in the card header ("on"). On (the default): the bot replies in the channel by the rules below. Off: the bot is completely silent in this channel, and all messages wait for your reply in the Inbox.

## What to reply to {#dbot-scope}

- "Orders only" (the default): the bot replies only when it is addressed: "start", "catalog" or your trigger word, a material code (for example #245 or a word from the card's keywords), buttons, a receipt for an order, and while the buyer is chatting with it. It stays silent on ordinary messages: the dialog stays unread, and you see in the app whom to answer.
- "All messages": the bot replies to any message and passes questions to you.

## Commands and reply to unclear messages {#dbot-triggers}

"Words customers use to call the bot": your own words separated by commas, for example "order, price list, want to buy". The built-in "catalog", "cart", "buy" always work.

"Reply to a short or unclear message": your own text instead of the standard one. Empty means the standard reply. This text does not replace product search, the cart or checkout.

## Bot pause after you reply by hand {#dbot-pause}

If you replied to the buyer yourself from the Instagram or WhatsApp app, the bot stays silent in that dialog for the chosen time: "15 minutes", "30 minutes" (the default), "1 hour" or "Until the end of the day". This way the bot does not interrupt your conversation. The "menu" and "cart" commands and button presses always work, and the bot accepts a receipt at the payment step even during the pause.

The consultant has its own pause in hours; while either of the two is running, it stays silent.

## Available in chat {#dbot-features}

The "catalog", "search by number", "cart", "checkout" checkboxes are which parts of the shop work in the chat. Untick one and the bot will not do it in this channel's chats, and such messages reach you as an ordinary question.

## Quick purchase from automation {#dbot-express}

Instagram only. On (the default): a "+" or a code word under a reel places an order for the rule's product right away: the buyer gets one message with the amount and payment buttons, without "Buy", the cart and "Checkout". Quick purchase works only when both "cart" and "checkout" are on. Off: the buyer goes the usual way through the "Buy" button and the cart. Rules under posts are set up in the [Instagram](/admin/instagram) section.

## Instagram quick questions {#ice-breakers}

Prompts the buyer sees when writing to you in Direct for the first time: "Catalog", "My orders", "How to pay", "Contact the seller". Tapping opens the matching part of the shop or a request to describe the question. The texts can be changed, up to 80 characters; the checkbox next to a line turns the prompt on.

The "on" switch in the header (off by default). The prompts appear only when the Instagram autoresponder and the "Shop in Direct" module are on; "Catalog" and "How to pay" only when those parts of the shop are on. If Instagram did not accept the prompts right away, the card says so, and the platform tries again by itself.

## Autoresponder · WhatsApp {#dbot-whatsapp}

The same settings as for Instagram: the switch, "What to reply to", commands, reply to unclear messages, the pause after your reply and "Available in chat" (without quick purchase). Plus two settings for WhatsApp only.

## Exclusion list and WhatsApp template {#dbot-wa-extra}

"Do not reply to numbers on the exclusion list (Broadcasts section)" on: the bot stays silent with numbers from this list (for example, your staff or wholesale buyers), and you reply to them yourself.

"Template for messages outside the 24-hour window": WhatsApp allows writing to a buyer in free text only within a day after their message. For order notifications to arrive later as well, enter a Meta-approved template with one parameter and the language after a colon, for example order_update:ru. Without a template the bot tries to send a regular message, and WhatsApp may not let it through.

A cart from the Meta catalog: for the bot to place such an order itself, put the product id, its number or its exact name from the admin panel as the SKU in the Meta catalog.
