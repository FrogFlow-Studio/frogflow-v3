# Broadcasts, automated messages and giveaways

keywords: broadcast, broadcasts, mass message, mailing, message everyone, message to buyers, automated messages, abandoned cart, win-back, auto-funnel, birthday, giveaway, contest, whatsapp template, a/b test, segment
group: guide
order: 210
pages: /admin/broadcasts

Here you send messages to many buyers at once in Telegram and WhatsApp, set up automated messages (cart, win-back, funnel, birthday) and run giveaways. Where to find it: "Menu → Marketing → Broadcasts"; giveaways — "Menu → Marketing → Giveaways" (the same page, the block at the bottom).

Any staff member with the broadcasts module can view it; managers and above can start and stop broadcasts. Only the shop admin and owner can save the automated message cap and the cart reminder settings.

## Telegram or WhatsApp {#channel}

If both channels are connected, there is a "Telegram" / "WhatsApp" switch at the top.

- Telegram: messages go out to 25 people per minute — Telegram won't accept them faster. Those who blocked the bot are counted separately.
- WhatsApp: outside the 24-hour window Meta lets the first message through only as an approved template, and Meta charges for each delivered message at its own rate.

While a broadcast is running in a channel, you can't start a new one in it.

## Text and photos {#text}

"Message text" — up to 4000 characters. You can use bold, italics and links (the hint under the field shows how). "Photos (up to 10)" — add photos with the "+ Add photo" button.

## A/B test {#ab}

The "A/B test: a second text for half of the audience" checkbox opens the "Variant B text" field.

On — the audience is split in half at random: variant A goes out at the scheduled time, variant B right after it (about a minute later). The history shows each variant's share of button clicks, so you can see which text worked better.

Off — everyone gets the same text. The A/B test doesn't work for "Test to myself".

## Buttons under the message {#buttons}

- The "“Open catalog” button" switch. On — under the message there is a "📚 Open catalog" button that opens the catalog in the bot. Off — no button. Available only to shops that sell.
- "“Enter the giveaway” button under the message" — choose a giveaway, and there will be an entry button under the message. Only giveaways that are accepting entries and don't run only on Instagram are available.
- "Product buttons" — up to 8 products. Each "📖 Product" button opens that product in the bot; hidden products are skipped.

The bot adds an unsubscribe button under every broadcast by itself. People who unsubscribed no longer receive broadcasts.

## Audience {#audience}

- "Everyone" — everyone who has written to the bot in this channel.
- "Buyers" — those with at least one paid order.
- "Have not bought yet" — wrote to the bot but didn't pay.
- "By country" — chose this payment country in the bot.
- "Segment" (Telegram only): bought a product, bought from a category, haven't bought for N days, bot language, abandoned a cart, course students, buyer tag, didn't order after a broadcast.
- "Test to myself" — only the admins from the settings. Handy for seeing how the message looks. If the admins have no Telegram set, the page will tell you.

"Recipients: N" shows how many people will get the message right now. People who unsubscribed or blocked the bot don't get the message.

## Resend to non-buyers {#followup}

3 days after a broadcast, a "Resend to non-buyers" button appears in the history. The new message goes only to those who got the selected broadcast and didn't place an order in those 3 days. People who unsubscribed, blocked the bot or have already been messaged today beyond the automated message cap won't get it. "Cancel and choose the audience by hand" returns the usual choice.

## Send later {#schedule}

The "Send later" switch.

On — pick a date and time: from 1 minute to 60 days ahead. The button changes to "Schedule".

Off — the broadcast starts right after "Start broadcast".

## WhatsApp broadcast {#whatsapp}

1. "From which number" — if you have several numbers.
2. "Template" — only templates approved by Meta.
3. Fill in the placeholders — values for spots like {{1}} in the template.
4. Choose the audience ("To"; WhatsApp has no segments) and click "Start broadcast".

Meta charges for each delivered message at its own rate.

## Meta templates {#templates}

A new template: "+ New template", enter the account, name (latin letters, digits, "_"), language, category ("MARKETING" — promotions, "UTILITY" — service messages, cheaper), text up to 1024 characters and up to three buttons. Click "Submit for review"; the status is updated with the "Refresh from Meta" button.

"Do not message these numbers" — numbers separated by commas or new lines, in international format. No broadcast will go to them, whatever you choose in the audience.

## Automated messages per day {#cap}

"Messages per day" — the overall cap per buyer for 24 hours. Counted: the cart reminder, "Similar materials", win-back, the auto-funnel, the rating request, the sale reminder, "Resend to non-buyers" and the birthday greeting. Payment and order messages aren't counted. "0" — no limit.

## Abandoned cart reminder {#cart}

"After how many hours" after the buyer put products in the cart and didn't place an order, the bot reminds them once: it names up to three products and the total at current prices. Unavailable products aren't mentioned; if nothing is available, there's no reminder. A new product in the cart allows the next reminder.

In Telegram the reminder always goes out; in Instagram and WhatsApp only within 24 hours of the buyer's last message. "0" — turn off. "Preview" and "Send to myself" show what the reminder looks like.

## Win-back {#winback}

The "on" switch.

On — the bot itself writes to those who haven't ordered for a long time: the "First message" N days after the last order, the "Second message" if the person still hasn't come back. It doesn't write to those with an open order or whose cart changed in the last 24 hours. Only during the day in your time zone, no more than 50 messages per hour, and no more often than the automated message cap. In Instagram and WhatsApp the message gets through only if the buyer wrote to you in the last 24 hours; otherwise it isn't sent and isn't retried.

Off — the bot doesn't write.

"Promo code" — optional; the code must exist in [Discounts](/admin/discounts). Without it, the line with {promo} isn't sent. {name} in the text is replaced with the buyer's name.

## Similar materials {#similar}

The "on" switch.

On — N days after a purchase the bot offers the buyer up to three products from the same categories that they haven't bought yet. Once per order, only in Telegram and only during the day. Products come as buttons under the text, {name} is the name.

Off — no offers.

## Auto-funnel {#funnel}

A series of messages to a new buyer, timed in hours from their first contact with the bot: introduction, value, offer.

- The "on" switch starts and stops the series.
- Each step: "N h from first contact", the text and the "“Catalog” button" checkbox (there will be a catalog button under the message).
- "+ Step" adds a step.
- The "Stop the series after the first order" checkbox: on — a buyer who has purchased no longer gets the series steps; off — gets all steps.

Messages go out only during the day in your time zone; overdue steps aren't sent in a batch.

## Birthday greeting {#birthday}

The "Greet customers on their birthday" checkbox.

On — during the day in shop time, once a year, the buyer gets the "Greeting text". {name} is the name, {promo} is the promo code from the "Gift promo code" field (create it in [Discounts](/admin/discounts) in advance). The buyer sets their birthday themselves via the "The customer can set the date via this link" link under the form — send it to your buyers. You can also enter the date in the customer card.

Off — no greetings.

## Giveaways {#giveaways}

"New giveaway": title, prize, "Where it runs", terms, "Entries until" and the number of winners. When the entry period ends, the system closes entries itself, picks the winners, writes to them and sends you the result in Telegram. The draw is fair and verifiable: the order of places is computed from a random number that is saved along with the list of participants.

- "Where it runs": "Telegram", "Instagram" or "Telegram and Instagram". In Telegram people enter via the "Entry link" or the "Enter the giveaway" button under a broadcast.
- For Instagram: "Instagram account", "Giveaway post", "Word in the comment" and "Direct reply". A comment with the word under the post is an entry, one entry per account. If a [Comment-to-DM](/admin/help?a=instagram) rule is set up on the same post, remember: Instagram allows only one private reply per comment.
- "Channel subscription (optional)" — a public channel like @name; the bot must be an admin there. Only subscribers can take part, and the subscription is rechecked when winners are picked.
- The "Do not pick buyers you have blocked" and "Do not pick shop staff" checkboxes exclude these people from the draw.
- "Prize promo code, % off": 0 — no promo code, we'll tell the winner that you'll get in touch yourself; otherwise the winner gets a one-time personal promo code.
- "Consolation promo for the rest, % off": 0 — don't send; otherwise it goes once to the other participants in Telegram and in Instagram (if the reply window is open), within the automated message cap.
- "Promo code validity, days".

While entries are open, you can "Edit" the giveaway or "Close entries" early. After the draw, the "Results" button shows participants, eligible ones, new buyers and revenue for 14 days.

## History {#history}

For each broadcast: total, delivered, blocked (in WhatsApp — "not on WhatsApp"), errors and button clicks. "Brought in: N orders, M paid" — recipients' orders within 3 days after sending. This is a coincidence in time, not a proven cause.

"Stop" stops the broadcast; messages already sent remain.
