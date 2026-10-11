# Settings: bots and notifications

keywords: notifications, alerts, quiet hours, digest, email, push, stock, low stock, running out, consultant, vip, broadcasts, cart reminder, referral
group: guide
order: 430

The "Bots" topic on the [Payment and settings](/admin/settings) page: which notifications you get and where, the low stock warning, push to your phone and links to the consultant, VIP, broadcast and discount settings. Changed by the owner and administrators.

## Notifications {#notify}

Available with the "Duplicate notifications" module. What comes to you and where. Telegram: to all recipients from the "Telegram ID for order notifications" field (the "Shop" topic); email: to the address below. Saved with the "Save" button.

## Which events and where {#notify-kinds}

The "Event / Telegram / E-mail" table. A tick means this event comes to this channel.

- "New order and receipt", "Material delivery failure", "Payment complaint" are urgent: they always come to Telegram, including during quiet hours; you cannot untick Telegram for them, but you can add email.
- "Customer question, consultant lead", "WhatsApp catalog cart", "Instagram or WhatsApp disconnected", "Pickup or delivery tomorrow", "Everything else (service)" can be turned off or moved to email.

By default everything comes to Telegram and email is off. If email sending is not set up on the platform, the "E-mail" column is inactive.

## E-mail for notifications {#notify-email}

The address that receives emails for the ticked events. Emails are sent from the platform's address.

## Quiet hours {#notify-quiet}

A checkbox and a "from – to" time (22:00–08:00 by default, in the shop's time zone). During quiet hours non-urgent notifications do not come; they pile up and arrive in the morning digest. Urgent ones come right away.

## Morning digest {#notify-digest}

A checkbox and the "send at" hour. A summary for the day: orders awaiting confirmation, undelivered items and everything held overnight.

## Check notifications {#notify-check}

The "Check notifications" button sends a real test message to each recipient over each enabled channel and shows whether it arrived. Common reasons it did not: the recipient did not press "Start" in the bot or the ID has a typo, the recipient blocked the bot, no email address is set.

## Running out of stock {#low-stock}

Available with the "Inventory" module.

"Warn when no more than this is left": when a product's stock drops to this number or below, you get one message. 0 means no warning. Only products with stock tracking count; a product can have its own threshold in its card.

"Show buyers "Only N left"" on: when stock is no more than the threshold, the buyer sees the exact number on the storefront and in the chat. With a threshold of 0 nothing is shown. The label does not appear for a product with pre-order and without stock tracking.

## Push on this device {#push}

Order notifications come right to your phone or computer, even without Telegram. The setting works only for the browser and device where you turned it on.

1. On a phone, first add the admin panel to the home screen: "Share → Add to Home Screen" or "Install app".
2. Open this card from the installed admin panel and press "Enable push".
3. Allow notifications when the browser asks.

"Turn off" disables push on this device. If the browser says notifications are blocked, allow them in the site settings. The card is not shown if push is not set up on the platform.

## AI consultant {#consultant}

The consultant switch, replies to comments, the profile and the knowledge base are on the [AI consultant](/admin/consultant) page.

## VIP subscriptions {#vip}

Available with the "VIP subscriptions" module. The private group, auto-approval, expiry reminders and the welcome message are on the [VIP](/admin/vip) page.

## Broadcast limits and cart reminder {#broadcast-limits}

How many hours later to remind about an abandoned cart and how many marketing messages a day a buyer gets are on the [Broadcasts](/admin/broadcasts) page.

## Referral discount {#referral}

The referral link discount is set up on the [Discounts](/admin/discounts) page.
