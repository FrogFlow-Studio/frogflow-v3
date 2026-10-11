# VIP subscriptions: a paid private group

keywords: vip, subscription, paid group, private channel, private chat, club, subscription access, renewal, tariff, plan, membership, remove from group
group: guide
order: 250
pages: /admin/vip

Paid access to a private Telegram group: tariffs, accepting payment proofs, reminders before the term ends and removal when it expires. It works through a separate VIP bot. Where to find it: "Menu → Marketing → VIP subscriptions" (available when the VIP module is on).

Any staff member can view it; managers and above can confirm payments and change tariffs. Only the shop admin or owner can save the "VIP settings" card.

## VIP bot {#bot}

1. Create a separate bot in @BotFather and paste its token into the "VIP bot token" field.
2. Add this bot to the private group as an admin with the right to invite and remove members.
3. Enter the group ID in "VIP settings".

"Connect" checks the token and connects the bot. "Replace" — if you changed the bot. "Disconnect the VIP bot" unlinks it from the shop: subscribers will no longer get replies or reminders from it.

## VIP settings {#settings}

- "VIP group ID" — a negative number like -1001234567890.
- "First reminder" and "Second reminder" — how many days before the subscription ends the bot reminds the member to renew. The second must be strictly less than the first.
- "Activation message" — what the member gets when the subscription starts.
- "Payment details" — the buyer sees them after choosing a tariff and sends the payment proof to the same chat.
- "Check expiries now" — immediately send the due reminders and remove those whose term has ended (this normally happens automatically).

## Test mode {#test-mode}

The "Test mode: periods in minutes instead of days" switch.

On — subscription and reminder periods are counted in minutes (the tariff's "Duration in test mode, minutes" is used). This way you can test the whole path in half an hour: payment, group link, reminder, removal.

Off — normal operation, periods in days. Don't forget to turn test mode off before launch.

## Automatic check {#auto-confirm}

The "Automatic receipt check: if it matches, the subscription renews itself" switch.

On — the payment proof is compared with the tariff price the same way as for orders: underpayment in the same currency is not accepted. If it matches, the subscription starts or renews without you. A doubtful one comes to you with buttons. You need the "Automatic receipt check" module and a free monthly check limit, otherwise a warning appears under the switch.

Off — you confirm each payment yourself in the "Subscribers" list.

## Tariffs {#tariffs}

"+ Tariff": "Name", "Description", "Price", "Currency", "Duration, days", "Duration in test mode, minutes" and "Order" (position in the buyer's list). Each tariff has its own link — you can send it to a buyer.

## Active, Public, First entry {#tariff-flags}

- "Active": on — the tariff can be bought; off — the tariff is not offered.
- "Public": on — the tariff is visible to everyone in the VIP bot and subscriptions are renewed on it; off — the tariff is hidden: available only via a personal link and assigned to that member.
- "First entry": on — the tariff is shown to new members once (for example, a discounted trial month); renewals then go on public tariffs.

## Subscribers {#subscribers}

A status filter ("Awaiting payment", "Active", "Expired", "Rejected") and search by name, @username, ID or tariff.

- "Open" — view the payment proof.
- "Confirm" — the payment is correct, the subscription starts, the member gets the group link.
- "Reject" — enter a reason, the buyer will see it.
- "± days" — extend or shorten the term.
- "Resend link" — if the member lost the invitation.
- "Remove" — remove from the group and close access.

## Add a member manually {#manual}

For those who paid outside the bot: "Telegram ID", "Tariff", "Days (empty — per tariff)" and "Status": "Active — send the link" (the member gets the link right away) or "Expired — history only" (just a record without access). Click "Add".
