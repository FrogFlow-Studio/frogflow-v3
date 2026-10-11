# Inbox: conversations with buyers

keywords: inbox, chat, messages, conversations, dialogs, direct, dm, reply to a buyer, pause the bot, join, assignee, quick replies, invoice, 24-hour window, why the bot replied, vkhodyashchie, perepiska

group: guide

order: 30

pages: /admin/chat

All conversations with buyers from Telegram, Instagram and WhatsApp in one window. From here you reply to a buyer, pause the bot, assign a responsible person and send an invoice. Where to find it: "Menu → Sales → Inbox", the item is pinned under "Overview", the number next to it is unread conversations. The section exists if the manager chat module is connected.

Any employee except the accountant can read conversations. Replying, assigning and changing the status is for a manager and above.

## Filters and search {#filters}

- "Open", "Resolved", "All" — the dialog status.
- "Everyone", "Mine", "Unassigned" — whose dialogs to show.
- "Unread" — only those with new messages.
- Channel: "All channels", Telegram, Instagram, WhatsApp.
- "Search by name or @username".
- "Search message text" looks for a word in messages; when you open the result, the found message is highlighted.

At the bottom of the list "Show more" loads older dialogs.

## Assignee {#assignee}

The "Assignee" list in the dialog header: "unassigned" or an employee from the shop's team. The "Mine" filter shows dialogs where you are the assignee. If a dialog belongs to nobody, it is assigned to whoever replies to the buyer first.

## Resolve and Reopen {#resolve}

"Resolve" moves the dialog to "Resolved". If the buyer writes again, the dialog returns to "Open" by itself. "Reopen" brings it back manually.

## Join the conversation and Hand back to the bot {#join}

"Join the conversation" means you are leading this conversation: the bot does not answer the buyer instead of you. The reply field says "Write to the customer…". While you have not joined, the hint in the field reminds you: "Your reply goes to the customer; to stop the bot answering instead of you, join the conversation".

"Hand back to the bot" removes your connection, and the AI consultant answers this buyer again right away, without waiting for the pause.

## Bot pause after your reply {#pause}

When you send a reply from here (or from "Requests"), the AI consultant goes quiet in this dialog for the time chosen in the [consultant settings](/admin/consultant), and its tasks for this buyer are closed: you have already replied. The header shows "bot silent until …" or "bot silent until you resume it".

## Resume the bot {#resume-bot}

The button appears when the dialog is paused. The consultant answers the buyer again right away, without waiting for the pause to end.

## Replying to a buyer {#reply}

Type the text and press "Send". The message goes to the buyer's channel: Telegram, Instagram or WhatsApp. Pressing again after a failure will not duplicate the message in Instagram and WhatsApp.

"📎 Photo or file" attaches a file: a JPEG or PNG photo up to 5 MB, a PDF, Word, Excel, PowerPoint, ZIP or TXT document up to 20 MB. "Remove attachment" removes it before sending.

## The 24-hour window {#window-24h}

Instagram and WhatsApp let a shop write freely only for 24 hours after the buyer's last message. The header shows "reply window: … h … min left" or "24-hour window closed".

- WhatsApp, window closed, an approved template exists: the message goes out as the template, and your text becomes part of it (as one line, an attachment as a link).
- WhatsApp without a template: an ordinary message will not go out. The window opens when the buyer writes themselves.
- Instagram: the message may not be accepted. The window opens when the buyer writes themselves.

Telegram has no such limit.

## Why the bot replied this way {#why-bot}

Under every bot message marked "bot auto-reply" there is an expandable line "Why the bot replied this way". It shows what the bot understood and why it answered that way: "Step", "Command", "Trigger word", "Button", "Understood as", "Rule", "Source", "Handed to a manager" and others. If the reason was not saved — "No reason recorded." This helps you see which rule or setting to fix.

## Send an invoice {#invoice}

The button is there if an order can be placed in the buyer's channel. Find the product in "Search products by name", choose the "Variant" and "Quantity", and press "Send invoice".

- In Telegram the buyer gets a list with the total and a "Checkout" button. Then payment and delivery go as usual, and the dialog returns to the bot.
- If checkout goes through the storefront, the buyer gets a link to the order page: payment by card or by receipt there, and the materials after payment. Physical products cannot be invoiced by link.

If an invoice cannot be sent, the panel tells you what to switch on in the [settings](/admin/settings).

## Add to the cart instead of replacing it {#invoice-append}

The tick appears when the buyer's cart already has something in it. On — the invoice is added to the cart. Off — the cart is replaced by the invoice.

## Quick replies {#quick-replies}

Ready phrases inserted with one tap. "Edit" opens the list: "Name" and "Text". In the text you can write {name} — the buyer's name, {order} — the number of their last order, {ticket} — the number of their request. "Add reply", "Remove", "Save". The same replies are available in "Requests".

## Remind about an unanswered dialog {#unanswered}

The "Remind me about unanswered chats:" list — "never", "after … min" or "after … h". If the buyer waits longer for a reply, one Telegram message comes for each wait — when you have joined the dialog, an assignee is set or a request is open.

## Message the owner once more {#unanswered-escalate}

The "If nobody replies, message the shop owner once more after the same wait" tick. On — if nobody has replied after the first reminder, the shop owner gets a second one. Off — there is one reminder.

## Buyer panel {#customer-panel}

To the right of the conversation: points, purchase total, recent orders, open requests, "Tags and note" and the "Customer card" link. Only the team sees tags and the note. If the person is not in the base — "The customer is not in the database: profile not found."
