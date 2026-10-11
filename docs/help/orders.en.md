# Orders: the list, the order card, a manual order

keywords: orders, order, payment, confirm, deliver, reject, refund, give money back, remind, status, delivered, accepted, ready, delivery, pickup, tracking, track number, cdek, print, labels, manual order, deposit, balance, overpayment, zakaz, zakazy

group: guide

order: 20

pages: /admin/orders

Here are all orders from the bot, Instagram, WhatsApp, the storefront and the ones entered manually. On the left are queues by status, in the middle the list, on the right the card of the selected order with the main button. Where to find it: "Menu → Sales → Orders", the item is pinned right under "Overview". The list refreshes by itself when a new order comes in; on a phone, pull the list down.

All employees can view orders, including the accountant (buyer contacts are not shown to them). Only a manager and above see the action buttons.

## Order statuses {#statuses}

- "awaiting payment" — the order is placed, there is no money or receipt yet.
- "receipt review" — the buyer sent a receipt, your decision is needed.
- "paid" — the payment went through by card, the order is waiting to be delivered.
- "delivering" — the materials are being sent to the buyer, or the bot is waiting to learn in which language to send them.
- "delivered" — the materials are sent or the physical order has been handed over.
- "accepted", "in progress", "ready" — the steps of a physical order.
- "rejected", "cancelled", "Refunded" — the order is closed without delivery or the money was returned.

## Queues {#queues}

The buttons on the left pick orders by status, with the count next to them: "All", "Receipt review", "Awaiting payment", "In progress", "Ready", "Delivered", "Rejected", "Refunds". "In progress" holds only orders with the "accepted" status; "in progress" orders in production are not in this queue, look for them in "All". Cancelled unpaid orders are visible in "All".

## How many orders the list shows {#list-limit}

The list shows the last 100 orders for the chosen filter. To find an older order, type its number into the search — the number finds an order of any age.

## Search {#search}

The "No., name, phone" field and the "Search" button. A number of up to 6 digits is searched as an order number. Anything longer, or text, is searched by the buyer's name, username, phone and email. An accountant searches only by number.

## Due, load and "To pack today" {#pickup}

Only for confectionery and flower shops.

- "Due:" — "today", "tomorrow", "overdue", "no date": open physical orders by the day of receipt, nearest at the top. Pressing again removes the filter.
- "Load:" — how many orders there are for today and tomorrow and by handover time; red if your limit of orders per day or per slot has been reached.
- "To pack today" — "accepted" and "in progress" orders to be received today.

## Underpaid {#unpaid}

Physical orders where a deposit was paid, but not the whole amount. Rejected and cancelled ones are not included. The button is shown in confectionery and flower shops, or when such orders exist.

## Export to Excel {#export}

The button is there if the export module is connected. Set "From date" and "To date (inclusive)" or leave them empty — then all orders are exported.

- "Download CSV" — orders with line items and contacts.
- "Payments (CSV)" — a line for each payment in the period, by payment date, without buyer contacts. Handy for an accountant. Deliveries without a receipt, online payments of physical orders before 28.09.2026 and orders older than 180 days are not included.
- "All data (ZIP)" — orders, line items, buyers and the catalog in one archive.

A "view only" employee can download only "Payments".

## Selecting several orders {#batch}

The tick by an order selects it, "Select all orders on the page" selects all visible ones. If the filter has more orders, "Select all … by filter" appears. Above the list is the "Selected: …" bar:

- "Packing slips" and "Delivery labels" open printing in a new tab. No more than 200 orders at a time.
- "Clear selection" clears the selection. The selection is also reset when the filter changes.

## Mark as packed {#assemble}

"Mark as packed" moves the selected "accepted" and "in progress" orders to "ready" and tells the buyers their order is ready. It does not write to buyers of manual orders: they have no chat. Other selected orders do not change. Afterwards you see the result: how many were packed, how many were already ready, how many did not fit, who did not get the message. If it says "Did not manage to process …", press it again. The button is for a manager and above.

## Order steps {#steps}

At the top of the card are the steps: "New" → "Receipt to check" → "Delivered". A physical order has "In progress" and "Ready" between them, and for delivery the last step is called "Shipped". A closed order (rejected, cancelled, refunded) has no steps.

Under the steps there is one main button — the next allowed action. Everything else is in the "More" menu.

## ✅ Confirm and deliver {#confirm-deliver}

The main button of a digital order in the "awaiting payment", "receipt review" and "paid" statuses. Press it when you are sure the money has arrived. What happens:

1. The order moves to "delivering"; pressing again will not duplicate anything.
2. A payment for the whole order amount is recorded in the history and in the "Money" block.
3. The files of each product go to the buyer: in Telegram — to the chat, a storefront buyer — to the order page and a copy by email, in Instagram and WhatsApp — to the dialog. For a course a link to the lessons is sent.
4. If a product has files in several languages and the buyer has not chosen a language, the bot asks them. The order stays "delivering" until they reply.
5. When everything is sent, the order becomes "delivered", the buyer gets a delivery message and the points earned, and whoever invited them gets the referral reward.

If some files did not arrive, the order returns to "receipt review" with the "Delivery failed" note in the history, and you get "Delivered …, failed …". Check the product files and press the button again: positions already sent will not go again, the bot sends the rest.

After the decision, the order notification in your Telegram loses its buttons and is deleted after 5 minutes.

## ✅ Accept order {#accept-physical}

The main button of a physical order in the "awaiting payment" and "receipt review" statuses. The order becomes "accepted", and the buyer gets a message that the order is accepted.

If the buyer sent a receipt, pressing it confirms the money: the amount due now under the shop's rules (deposit or the whole sum) is recorded, minus what was already paid. From "awaiting payment" the order is accepted without recording a payment — record it later in the "Payment" card.

## → In production, → Ready, → Delivered, → Shipped {#next-step}

The next steps of a physical order: "accepted" → "in progress" → "ready" → "delivered". For delivery the last button is "→ Shipped". At each step the buyer gets a message about the new status. At the "delivered" step points are credited and the inviter gets the reward. If the status was already changed from another device, you will see "The status has already changed".

## ← Step back {#step-back}

In the "More" menu: "in progress" → "accepted", "ready" → "in progress". Nothing is sent to the buyer. A delivered order cannot be moved back.

## ⏰ Payment reminder {#remind}

In the "More" menu, only for "awaiting payment" orders. The buyer gets a reminder with the amount: in the chat — with the payment details or a payment link, a storefront buyer — by email with a link to the order page. One reminder per order: the second time the button answers "A reminder for this order has already been sent". The system can send the same reminder by itself — then a manual one will no longer go out.

## Printing and the order link {#print}

In the "More" menu:

- "🖨 Print" — the sheet of a physical order.
- "Print the slip" — the packing slip, if the order has gift wrapping.
- "🔗 Copy order link" — a link to the order page for the buyer.

## Reject {#reject}

In the "More" menu, in red. Available while the order is not delivered and not closed. It asks "Reject the order? The customer will be notified." What happens:

- the order becomes "rejected", the buyer gets a message;
- points spent in the order go back to the buyer (if nothing has been credited to them for this order yet);
- if the order was not paid, the promo code and gift certificate are returned;
- product stock goes back to the warehouse for storefront orders, unpaid orders and invoices sent as a link.

If the buyer has already paid, you return the money yourself and record it in "Refund".

## Money {#money}

The "Money" block shows "Order total", "Discount", "Payment method" (receipt, manual or "No payment yet"), "Received", "Still to receive", "Refunded". Red and yellow notes suggest what to do:

- "The order is closed: fulfil it or refund the money" — money came for a rejected or cancelled order.
- "There is an overpayment: refund the difference to the buyer".
- "The payment amount or currency does not match the order".

## Money movement {#money-journal}

A list of all payments and refunds on the order with date and amount: "Payment", "Balance", "Refund", "Payment not counted", "Payment on a closed order", "Payment above the balance". A payment shows its number, a refund shows which payment it is for and the reason. If there was no money — "No money has moved on this order yet."

## Payment receipt {#proof}

The picture of the receipt the buyer sent (a PDF opens by link). If there is no receipt — "No receipt yet." A receipt for the balance of a physical order is a separate "Balance receipt" link. When the amount on the receipt is recognized, a note next to it says whether it matches what the order expects.

## Payment of a physical order {#payment}

The "Payment" card exists only for physical orders: "Paid", "Remaining" or "Paid in full", and how much is due now under the shop's rules.

The "Amount" field and the "Record payment" button record money that came past the bot: cash on handover, a transfer of the balance. "Whole remainder" records the entire missing sum. You cannot record more than the balance. No payment is accepted for a rejected or cancelled order. The order status does not change from this. The buttons are for a manager and above.

## Balance receipt {#balance-proof}

If the buyer sent a receipt for the balance, the "Payment" card shows "The buyer sent a balance receipt — check it and record the payment or reject the receipt." The money arrived — press "Whole remainder". It did not — "Reject balance receipt": the buyer can pay again or send another receipt.

## Refund {#refund}

The card is visible when there is something to refund on the order: the order is paid, delivering, delivered or in progress. You return the money to the buyer yourself (by transfer, through the till), and here you record the refund.

1. Press "Refund".
2. Enter the "Refund amount" or press "Full amount". You cannot refund more than was received.
3. Fill in "Reason — the customer will see it".
4. Press "Record refund" and confirm. A refund cannot be undone.

The refund goes into the order history and is subtracted from revenue in analytics. When the whole amount is refunded, the order gets the "Refunded" status, points spent in the order go back to the buyer, points credited for the order are taken away, and the promo code and certificate are returned. For a course, a full refund closes access to the course's private channel.

## Return items to stock {#refund-restock}

A tick in the refund form, present when stock tracking is on. On — all order items go back into stock. Stock is returned once per order, even if there are several refunds. Off — stock does not change.

## Notify the customer {#refund-notify}

A tick in the refund form, on by default. On — the buyer gets a message about the refund with the amount and reason in their channel. Off — the refund is recorded silently. If the message did not arrive, the refund is still recorded.

## Items and gift {#items}

"Items" — the order's products, quantity, price, "Total" and the discount. Under a product — in which languages it has files. "Gift" shows the recipient and the card text if the buyer ordered it as a gift.

## Photo for approval {#approval}

For a physical order in progress. Upload a "Photo (JPEG or PNG up to 5 MB)", optionally a "Comment to the photo", and press "Send to the customer". In Telegram the buyer sees the «Всё нравится» and «Нужны правки» buttons, in Instagram and WhatsApp — a request to reply «да» or write the changes, and a storefront buyer gets an email with a link to the photo. The reply is shown in the card: "The customer approved" or "The customer asks for changes". It does not work for a manual order — there is no conversation with it.

## Courier {#courier}

If the courier module is connected. Call a courier in Yandex Delivery, inDrive or your own, choose the "Service", paste the "Tracking link (https://…)" and the "Courier phone", and press "Hand over to courier". The buyer gets the link in their channel and on the order page. The order status does not change.

## History {#history}

A feed of everything that happened to the order: status changes and who made them, payments with amounts, the sending of each file, delivery failures, reminders, refunds, the courier, tracking. If delivery failed, there is a red "Delivery failed" note at the bottom.

## Buyer and fulfilment {#customer}

The buyer's name, phone, email and country. A physical order has "Fulfilment": delivery or pickup, date, time, zone, address, comment.

The "Edit" button lets you change the "Date", "Time", "Delivery zone", "Address", "Comment" and switch between delivery and pickup. Switching between delivery and pickup recalculates the order amount. If the day is a day off or already full by the limit, the panel warns you but saves the date.

## Sent by post or CDEK {#track}

For a physical order with delivery in the "ready" or "delivered" status. Paste the tracking number or link and press "Send tracking". A CDEK number (10 digits) or a Kazpost number (KZ…) goes to the buyer together with a link, another carrier's number goes as text. A "ready" order then becomes "Shipped". The same tracking number is not sent twice.

## Note {#note}

The "Note" field is visible only to you and the team; the buyer does not see it. Press "Save".

## Manual order {#manual-order}

For confectionery and flower shops: the "+ Manual order" button in the list or "New order" in the "+ Create" menu. For orders by phone and from conversations outside the bot. No notifications go to the buyer: they are not in the bot.

1. Enter the "Customer name" and "Phone". Orders of one person are gathered into one buyer by phone.
2. In "Items" choose the "Product", "Variant", "Qty"; "+ Item" adds a line. Only physical products are available, the price comes from the product card.
3. Choose "🚚 Delivery" or "🏠 Pickup", the "Date" (not earlier than the production time), and for delivery the "Delivery zone" and "Address".
4. Press "Create order".

Product stock is written off the same way as for an order through the bot.

## Already paid {#manual-paid}

A field in the manual order form. Above zero — the order is "accepted" right away and the amount is recorded as a payment. Zero — the order is "awaiting payment", and you record the payment later in the card.
