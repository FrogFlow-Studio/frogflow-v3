# Settings: payment and delivery

keywords: delivery, pickup, deposit, prepayment, time slots, closed days, delivery zones, free delivery, minimum order, payment reminder, robokassa, kaspi, apipay, prodamus, sbp, stripe, crypto, telegram stars, receipt recognition, card payment
group: guide
order: 410

The "Payment and delivery" topic on the [Payment and settings](/admin/settings) page: how the buyer receives a physical order, how much they pay and which online payment methods are connected. The payment provider cards (Robokassa, Kaspi, Stripe, Prodamus, cryptocurrency, Telegram Stars) are seen and changed by the owner only; everything else by the owner and administrators.

## Physical goods: fulfilment and payment {#fulfillment}

Applies only to physical orders (cakes, flowers, goods with delivery). It does not affect digital products. All fields are saved with one "Save" button.

## Pickup and delivery {#ful-pickup}

The "Pickup" and "Delivery" checkboxes are the ways of receiving the order the buyer can choose. Both are on by default. Untick the one you do not need, and the buyer will not be able to choose it.

## Payment for physical orders {#ful-payment}

- "Full prepayment by receipt": the buyer pays for the whole order and sends a receipt.
- "Deposit by receipt, balance on pickup": first the buyer pays a deposit (the "Deposit, % of total" field, 30 by default), the rest on receipt of the order.
- "Payment on pickup, no receipt": the order is placed without payment, the buyer pays on receipt.

## Time slots, closed days and limits {#ful-calendar}

"Time slots": one per line, for example "10:00–12:00". The buyer chooses a time after the date. Empty means date only.

"Closed weekdays" and "Closed dates" (one per line, "31.12.2026", or a range "30.12.2026–03.01.2027"). On these days the buyer cannot choose to receive the order, and production time is counted in working days only. You cannot mark all seven days of the week. Past dates are removed automatically.

"Orders per day" and "Orders per slot" are limits. Empty means no limit. Orders with a pickup date are counted, except rejected, cancelled and refunded ones. A buyer's unpaid order without a receipt holds its place for a day. A full date or slot is not offered to the buyer. Orders you enter yourself are not limited. The per-slot limit works only when slots are set.

## Delivery zones {#zones}

Areas with a delivery price. The buyer chooses a zone, and its price is added to the order. Without zones the bot simply asks for the address.

"+ Zone": "Name" (for example "Almaly district"), "Price", "Order", the "Active" checkbox. Unticking hides the zone from buyers.

## Free delivery {#free-delivery}

"General threshold": if the items in the cart after discounts and points cost at least this amount, delivery is free, and the buyer sees in the cart how much is left to add. 0 means no free delivery. Each active zone can have its own threshold; empty means the general one. A gift certificate does not affect the threshold: it is a payment, not a discount.

## Minimum order amount {#min-order}

The bot, the website and the Instagram/WhatsApp shop will not let an order below this amount be placed and will say how much to add. The cart total before discounts is counted. 0 means no minimum. Free products are not blocked by the minimum.

## Payment reminder {#pay-remind}

If an order from the bot, Instagram or WhatsApp is not paid, the bot reminds the buyer of the amount and payment details once, after the chosen time: 1, 2, 3, 6 or 12 hours after checkout. "Don't remind" turns it off. In Instagram and WhatsApp the reminder goes only if the buyer wrote to the shop within the last day: otherwise Instagram and WhatsApp do not allow writing first. Saved immediately.

## Don't remind for doubtful orders {#pay-remind-hold}

On (the default) — the reminder is not sent if the customer has an open request (they asked about another product or sent the receipt to you directly, e.g. in WhatsApp) or placed another order after this one. Instead you get a message "Order #…: payment reminder not sent" with a link to the order, and the order history shows the same note: cancel the order or confirm the payment. A request opened more than 3 days before the order with no new messages does not count. Off — the bot reminds as before.

## Email after payment (Instagram) {#email-ask}

Materials always come into the chat. "Ask for email after the receipt" on: after the receipt the bot asks for an email and sends a copy there. Off: it does not ask; if the buyer asks to get it by email, the bot asks for the address and sends the email.

## Email is optional {#email-optional}

On (the default): if the buyer answers the email question with “WhatsApp”, “here”, “to Instagram” or “no need”, the bot says once: “The files will come here, in this chat, once the receipt is checked. Email is optional” — and stops asking for an email. If they still send an address, it is saved. Text that looks like an address with a typo (“anna mail.ru”) gets a request to type it in full. Off: such replies come to you as a question.

## Receipt as text {#receipt-text}

Kaspi sometimes blocks screenshots, so the buyer pastes the receipt text from the app: “Оплата совершена 800 ₸ … № чека QR…”. On (the default): the bot treats text as a receipt when it has an operation number, or an amount with a currency together with receipt words (“оплата совершена”, “перевод выполнен”, “получатель”). The buyer gets “Got the receipt, passing it on for checking”, and you get the order notification with the receipt text and the «Подтвердить и выдать» button. The same operation number on another order is not accepted. Automatic checking does not read text: check the payment yourself. “I paid 800 tg” is not a receipt: the bot asks for a screenshot. Off: text at the payment step comes to you as a question.

## Telegram Stars {#stars}

Available with the "Telegram Stars payments" module. In the Telegram bot the buyer pays with stars in one tap, without cards or payment details. Stars go to the bot's balance; you can withdraw them via Fragment.

"Price of 1 ⭐" is the rate in the shop currency. The order amount is divided by the rate and rounded up. Empty means there is no stars payment button. The rate does not update by itself.

## Robokassa: card payment {#robokassa}

Card payment through your Robokassa account: in the Telegram bot, in Instagram/WhatsApp and on the website. The order is confirmed automatically when Robokassa reports the payment.

1. In your Robokassa account, enter the Result URL, Success URL and Fail URL from the card, the POST method and the MD5 algorithm.
2. Choose "Merchant country": "Kazakhstan (robokassa.kz, tenge)" or "Russia (robokassa.ru, rubles)".
3. Paste MerchantLogin, "Password #1 (live)" and "Password #2 (live)".
4. Tick "Enable card payments" and press "Save".

Robokassa charges in its own currency: the card payment button appears only for orders in tenge (Kazakhstan account) or in rubles (Russia account).

"Test mode": payments go through Robokassa test passwords, no real money is charged. Do not forget to turn it off before working with buyers.

For a Russian account: "Send a 54-FZ receipt (Robokassa online cash register)", "Taxation system" ("As in the merchant account" or your own) and "VAT". The fiscal receipt includes the items and delivery; the discount is spread across the items, and the receipt total equals the payment amount.

## Receipt recognition {#receipt-ocr}

Available with the "Receipt recognition" module. AI reads every receipt sent to the bot: amount, currency, date, operation number, recipient. The bot checks it against the order, the payment method details and earlier receipts and tells you in the notification and on the order card: "matched", "suspicious" with the reasons (signs of editing, a payment still "processing", a receipt dated before the order) or "repeat" (the same file or operation number was already used). A screenshot with no payment or a failed payment makes the bot ask to send it again. The bank does not confirm the receipt: check that the money arrived in your bank.

"Auto-check receipts" on: it works like this. Off: all receipts come to you unchecked.

"Deliver the order right away if the receipt matches" is off by default: you confirm the order with the button. Turn it on and a matching receipt delivers the files to the buyer by itself; suspicious receipts and repeats still come to you.

Honestly about the limits: if no recognition key is set on the platform yet, the card says so, the switch is unavailable, and all receipts go to manual review until the operator adds it. Above your plan's monthly limit and when the [AI balance](/admin/ai-balance) has run out, you also check receipts yourself. Below in the card is how many receipts were recognized this month and in total.

## Cryptocurrency: NOWPayments {#crypto}

Available with the "Crypto payments (NOWPayments)" module. In the Telegram bot the buyer gets an invoice in cryptocurrency; the order is confirmed automatically after network confirmation.

1. In your NOWPayments account, enter the IPN address from the card.
2. Paste the "API key" and the "IPN secret".
3. Tick "Accept crypto payments" and press "Save".

## Foreign card: Stripe {#stripe}

Available with the "Card payments from abroad (Stripe, PayPal)" module. Buyers from other countries pay by card or PayPal in the Telegram bot and on the website; the order is confirmed automatically.

1. In your Stripe account (Developers → Webhooks), add the address from the card with the events checkout.session.completed and checkout.session.async_payment_succeeded.
2. Paste into the card fields the secret key (starts with sk_) and the webhook signing secret (starts with whsec_) from your Stripe account.
3. Tick "Accept foreign cards and PayPal" and press "Save".

## Russian card and SBP: Prodamus {#prodamus}

Available with the "Prodamus payments (Russia)" module. For a seller with their own Prodamus account: the payment form accepts Russian cards and SBP. The payment button is in the Telegram bot, in Instagram/WhatsApp and on the website; the order is confirmed automatically.

1. In your Prodamus account, copy the payment form address and the secret key, and set the payment notification address to the one in the card.
2. Fill in "Payment form address" and "Secret key".
3. Choose "Checkout currency" and, if needed, "Rate".
4. Tick "Accept Russian cards and SBP" and press "Save".

How the amount is calculated. An order in the checkout currency is paid as is. If prices are in tenge and the checkout is in rubles, set the rate, how many tenge per 1 ruble: the amount in tenge is divided by it and rounded up to a whole ruble, and the buyer sees the amount in rubles. Without a rate, orders in tenge have no Prodamus button. The rate does not update by itself: change it here.

A form with a .kz address counts only in tenge. If it has a rate set, an order in rubles is billed in tenge at your rate (rounded up to a tenge), and the buyer's bank charges rubles from the card at the Prodamus rate. So set the Prodamus rate, not the exchange rate, otherwise more than the ruble price will be charged from the card.

## Kaspi: ApiPay {#kaspi}

Available with the "Kaspi Pay payments" module. A "Pay with Kaspi" button in the Telegram bot, Instagram and WhatsApp: the buyer pays in the Kaspi app, the money goes to your Kaspi Pay, and the order is confirmed and delivered automatically.

You need your organization in ApiPay with a connected cashier.

1. In your ApiPay account (Settings → API keys), enter the address from the card.
2. Paste into the card fields the API key and the webhook signing secret from your ApiPay account.
3. Tick "Accept Kaspi payments" and press "Save".

"Test mode" is the ApiPay sandbox: links are not real, and test payments count as real ones. Turn it off before working with buyers.
