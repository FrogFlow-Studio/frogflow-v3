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

## Messages without a question and payment from other countries {#direct-triage}

A card in “Payment and settings” when Instagram or WhatsApp and the in-chat shop are on. AI, not a word list, decides what kind of message arrived; the message always stays in “Chat”. AI cost is a fraction of a cent per message, at most $0.30 a day per shop.

## Messages without a question {#direct-chatter}

“Don’t open a ticket for “thank you”, emoji and “+”” is on by default. When a Direct or WhatsApp message has neither a question nor a request (“Thank you! 🌹”, “Bravo!”, “🔥”, “+”, “I’ve subscribed”), the bot stays silent and opens no ticket. AI decides what the message is from the message and the conversation, not from a word list. The message is still visible in “Chat”. To “thank you” after a delivered order the bot still replies once with the “Reply to thank you” text (Settings → Bot texts → Instagram). “Thanks, when will it arrive?” is a question and comes to you as a ticket. Off: every such message opens a ticket, as before.

## Payment from other countries {#direct-foreign-pay}

“Reply about payment from other countries” is on by default. The buyer asks whether they can pay from their country or in their currency (“Can I pay in Belarusian rubles?”, “I’m from Uzbekistan, how do I pay?”, “How much in som?”), and you have no payment method for that country. Once a day the bot replies: “We are setting up payments from your country right now. Your question has been passed to the seller, who will write here how to pay”, and the question comes to you as a ticket so you can send the payment details yourself. Change the text in “Settings → Bot texts → Instagram → Payment from another country”. If the country has a payment method, the bot takes the buyer through the usual path. Russia is not included: Russian card payment or your own details work for it. Off: the bot does not answer such questions, they come to you as tickets.

If such a buyer still chose a Kaspi transfer and writes “It won't work”, once per order the bot replies: “Kaspi only accepts cards from Kazakhstan. We are setting up payments from your country (Kyrgyzstan) right now: the seller will write here how to pay”, and doesn't ask for the bank. The bot takes the country from what the buyer wrote earlier (“I'm from Kyrgyzstan”). The question comes to you as a ticket. Text: “Settings → Bot texts → Instagram → Kaspi from another country”.

If such a buyer has already received the “we are setting up payments” reply and then taps “Buy”, the bot places the order but doesn't show the Kaspi transfer or “Russian card”: neither works for them. It writes: “Order #… is placed. We are setting up payments from your country (Kyrgyzstan) right now: the seller will write here how to pay”, and you get a ticket and a notification with the order number. The order waits for payment: if you send your payment details yourself, the bot accepts the receipt as usual. Tapping “Buy” again gets the same reply, without payment details. This works while “Reply about payment from other countries” is on and there is no payment method for that country. Text: “Settings → Bot texts → Instagram → Order from a country without payment”.

## “How do I get it?” after the “Buy” button {#direct-how-to-buy}

“Answer “how do I get it?” after the “Buy” button” is on by default. The buyer got a rule message with the “Buy” button and writes “How can I get it?” or “how do I order?”, with no order yet. AI, not a word list, decides that this is a question about buying. The bot replies “To get the material, tap “Buy” under the message: I’ll place the order and send you the ways to pay” and sends the button again, at most once every 30 minutes; a repeated question within that half hour comes to you. If an order already awaits payment (the payment step handles payment questions) or you are writing to the buyer yourself, the bot doesn't reply this way. Text: “Settings → Bot texts → Instagram → How to get the material”. Off: such questions come to you, as before.

## Several materials with one receipt {#direct-several-items}

“Answer “several materials with one receipt?”” is on by default. The buyer asks whether several materials can be bought or paid for in one order or with one receipt (“Can I pay for these 2 materials with one receipt?”). AI understands what kind of question it is. Once a day the bot replies: “Your question is with the seller: they will write here whether several materials can be paid with one receipt”, and the question comes to you as a ticket. If there is an order, it keeps waiting for payment. Text: “Settings → Bot texts → Instagram → Several materials with one receipt”. Off: the bot stays silent and the question comes to you, as before.

## Material the bot doesn't have {#direct-product-request}

“Answer a material name the bot doesn't have” is on by default. The buyer writes the name of a material (“Классный уголок”, “Материал для доски”), and there is no rule or product with that name. AI understands that this is a request for a material. Once a day the bot replies: “Your question is with the seller: they will write to you here. Meanwhile, you can browse the materials in the catalog”, with the “Catalog” button. The question comes to you as a ticket; if the buyer repeats the name, the repeats are added to the same ticket without a new reply. If the catalog is turned off in Direct, the bot doesn't reply. To have the bot send the material by its name, add a product and a rule with that name. Text: “Settings → Bot texts → Instagram → Material the bot doesn't have”.
