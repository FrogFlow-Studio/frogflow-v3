# Bot texts

keywords: bot texts, greeting, welcome message, outside working hours, working hours, order thank-you message, did not understand, custom text, standard text, schedule
group: guide
order: 510
pages: /admin/bot-texts

Here you change what the bot says on its own: the greeting, the reply outside working hours, the thank-you for an order and the reply when the bot did not understand a message. An empty field means the bot says the standard text. Where to find it: "Menu → Settings → Bot texts". Seen and changed by the owner and administrators.

## Channel and language {#channel}

At the top, choose the channel: "Telegram", "Instagram" or "WhatsApp". In Telegram all texts can be changed. In Instagram, the purchase messages in Direct: the questions about country and material language, "send the receipt after paying", how to send the receipt, replies to the receipt and the email question. In WhatsApp the bot still uses the standard words.

The language choice appears with the "Multi-language" module: then the text is set separately for each buyer language. If the field is empty for some language, a buyer with that language gets the standard text.

## Your text {#custom}

Each message has a "Your text" field of up to 1000 characters. In an empty field the standard text is shown in grey. Under the field are the placeholders you can insert, for example {shop}; the bot replaces them with the real values. If you wrote a placeholder that does not exist, the card warns you. The "What the buyer sees" block shows the finished message.

1. Type the text.
2. Check it in the "What the buyer sees" block.
3. Press "Save".

"Back to standard" deletes your text, and the bot uses the standard words again.

## Which messages you can change {#keys}

- "Greeting": when the buyer taps "Start" and picks a language. The {shop} placeholder is the shop name.
- "Outside working hours": when the buyer writes outside working hours, at most once every 6 hours. The {from} and {to} placeholders are the start and end of working hours. Not sent if working hours are not set.
- "Thank you for the order": a separate message after checkout. The {order} placeholder is the order number. Until you write your own text, this message is not sent.
- "Did not understand": the buyer wrote something the bot could not parse.

## Working hours {#hours}

Hours follow the shop's time zone (it is set in the "Shop" card on the [Payment and settings](/admin/settings) page). Outside these hours the bot sends the "Outside working hours" text.

1. Choose "From" and "To".
2. Press "Save hours".

"Remove hours": working hours are not set, and the "Outside working hours" message is not sent.

To see how the whole bot looks, use the [bot preview](/admin/bot-preview).
