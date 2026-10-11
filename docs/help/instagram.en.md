# Instagram: Comment-to-DM rules

keywords: instagram, insta, direct, dm, comment, auto-reply, comment to dm, reel, reels, code word, keyword, two steps, plus, buy button, sales from direct, requests, catch-up sending
group: guide
order: 230
pages: /admin/instagram

On this page you set up rules: a person writes a comment under a post or reel, and a private message with a material, a link or a "Buy" button immediately goes to them in Direct. Where to find it: "Menu → Marketing → Instagram". The section is visible if the Instagram module and the account itself are connected (how to connect — in the [How to connect Instagram](/admin/help?a=instagram-connect) article).

Any staff member can view the rules; managers and above can create, change, turn on and delete them.

## How Comment-to-DM works {#how-it-works}

Instagram allows a shop to reply to one comment with only one private message. You can't write first to a stranger: a Direct message goes out only as a reply to their comment.

1. A person leaves a comment that matches a rule (the right word, or any comment under the selected post).
2. The first message goes to them — the text from the "Direct message" field. The first message never has buttons: Instagram doesn't show buttons in the first reply to people who don't follow the account, and such a reply gets lost.
3. If the rule has buttons or "Two steps" is on, the first message ends with a call to reply, for example "Reply «+» to this message".
4. The person replies "+" (or any word) — and then the second message with buttons goes out.

For people who don't follow you, the first message lands not in the "Inbox" but in the "Requests" folder. If within a day after the first message the person writes under the post "nothing came" or "where's the link", the bot publicly replies to them in the language of the comment: "The message is already in your Direct 📩 If it's not in your inbox, check the Requests folder and reply «+» to it."

If one of your enabled rules fired on a comment, the AI consultant doesn't reply to that same comment — Instagram wouldn't let a second private reply through anyway.

## Rule list {#rules}

The "Comment-to-DM rules" card shows each rule: "active" or "off", the "2 steps" badge, what it triggers on (all posts, a specific post or story replies), the words, the message text and the "triggered … · DM …" counter. A red "failed N" is how many messages Instagram didn't accept.

- "+ New rule" opens an empty form above the list.
- "Edit" opens the rule in the form.
- "Copy" creates a new rule with the same texts, buttons and settings; you need to choose the post again. Handy when each reel has its own rule.
- "Delete" deletes the rule together with its trigger statistics. This can't be undone.

## Enabled {#enabled}

Each rule has an "Enabled" switch.

On — the rule replies to new comments, every 15 minutes the system sends the missed ones, and queued second messages go out.

Off — the rule sends nothing: neither first messages nor second ones, not even to those already waiting for a button who reply "+" later. A disabled rule isn't caught up by the backup check. A deleted rule behaves the same way.

If you want to pause sales from a post temporarily, turn the rule off rather than deleting it: the statistics will be kept.

## Trigger history {#history}

The "Trigger history" button under a rule shows the latest triggers (up to 100): status, the buyer's Instagram name, comment text, error and time. The "only failed" checkbox leaves only those where the message didn't go out. Handy for checking why a particular person got nothing.

## Name, account and "Triggers on" {#trigger}

"Name" is for you; the buyer doesn't see it. Make it clear: "Reel about copybooks". The rule name helps recognize the product when a person writes it in Direct without a comment, so it's best to name the rule the same as the product.

"Account" appears if several Instagram accounts are connected: choose which account the rule works in.

"Triggers on" (when there is one account):

- "comments on a post" — the normal mode;
- "story replies" — the rule replies when a person replies to your story. In that case the person is already writing to you in Direct themselves. The 15-minute backup check doesn't catch up on such rules.

If there are several accounts, the "Triggers on" field isn't shown in the form, and the rule is created for comments.

## Post {#post}

Choose the post or reel the rule works under, or "All account posts".

- A rule for all posts must have at least one keyword — otherwise it won't be saved.
- If a fresh reel isn't in the list, click "Refresh" or paste the post link and click "Find by link". New posts don't appear in the list right away, but within about an hour and a half.
- If a post in the list is marked "no Zernio id", its data hasn't reached the system yet, and a rule for it won't be saved. Paste the post link and click "Find by link".
- Changing the post of an existing rule recreates it — the counters reset.

Tip: make a separate rule for each selling post. The 15-minute backup check works only for rules on a specific post.

## Keywords and "Match" {#keywords}

"Keywords" — comma-separated, case doesn't matter: for example "want, price, palette". Empty — the rule replies to any comment under the selected post.

"Match":

- "contains" — the comment contains the word anywhere: "I want the palette" matches the word "palett";
- "exact" — the whole comment equals the word (extra spaces at the edges don't matter).

The code word works in Direct too: if a person writes the rule's word straight to your DMs (short, without a comment), the bot sends the rule's second message with buttons.

## Reply to any comment {#reply-to-all}

The switch is visible when a specific post is selected.

On — the rule replies to any comment under this post; keywords are cleared on save.

Off — the rule replies only to comments with keywords.

Note: for a rule without words, an order from a "+" reply is placed right away only if the comment names the product (the rule name, the product name or a word in quotes from the post caption). Otherwise the person gets the usual second message with a "Buy" button.

## Direct message {#dm-message}

The first private message, up to 1000 characters (with two steps — including the call to reply). Text only, no buttons. If the rule has buttons, write here what exactly the person will get and ask them to reply.

## Buttons under the message {#buttons}

Up to three buttons. They always go in the second message, never in the first.

- "+ Button" — your own button: "link" (opens an address) or "bot command".
- "+ Product" — find a product, and a "Buy" button for it is added to the rule.
- "+ To Telegram bot" — an "Open in Telegram ✈️" button to your Telegram bot (if it's connected).

If you are a consultant without sales, there is no "+ Product" button — instead there's a link to the consultant page.

## The "Buy" button {#buy-button}

Added with "+ Product". This is what turns comments into orders. Posts without a rule with "Buy" collect the most comments but bring no orders: the person simply has nothing to tap.

What happens when "Buy" is tapped in Direct:

- if cart, checkout and "quick purchase from automation" are on for Instagram conversations (in [Payment and settings](/admin/settings#dbot-instagram), the "Autoresponder · Instagram" block), the cart is emptied, this product is put in it, and one message with the total and payment buttons arrives right away;
- if only the cart is on — the product goes into the cart and the cart is shown;
- otherwise — the product card arrives;
- a product with variants or one that is discontinued — the card arrives so the buyer can choose a variant.

Quick purchase without tapping: if the rule has exactly one "Buy" button and the person replied to the first message with clear consent — typed "+", "да", "хочу", "1", "купить" — the order is placed right away instead of the second message. A heart, another reaction, a photo or a question ("do you ship to Belarus?") don't count as consent: the person gets the second message with the "Buy" button, the order appears only when they tap it, and their question goes on the usual way.

When you save a rule, the system checks the product against the post caption. If you see "The product “…” is not mentioned in the post “…” — please check", the rule is most likely looking at the wrong post or the wrong product. You can save it, but a buyer under a reel about one thing will get "Buy" for another.

## Two steps {#two-step}

The "Two steps: text without buttons first, buttons in a second message" switch.

On — the first message goes out as text with a call to reply, and after the person replies the second message arrives. If the rule has no buttons, the second message comes with an "Open in Telegram" button (when the shop has a Telegram bot).

Off — only the first message goes out, there is no second.

As soon as the rule has at least one button, "Two steps" turns on by itself and can't be turned off: otherwise there'd be nowhere to send the buttons. It happened once: "Two steps" was turned off in a rule, the "Buy" button disappeared, and orders from that post stopped. If you want a rule without two steps, remove the buttons first and remember that there will be no orders via the button then.

## Call to reply {#reply-prompt}

"Call to reply at the end of the first message" is appended to the first message's text, up to 200 characters. The default (in Russian): "Ответьте на это сообщение «+» (подойдёт любое слово), и я сразу пришлю кнопку, чтобы получить материал" — "Reply «+» to this message (any word will do), and I'll send you the button to get the material right away".

If you clear the field, there will be no call, but the second message to a stranger still goes out only after their reply. Without a call people reply less often, so keep it.

## Second message text {#second-dm}

The text above the buttons in the second message, up to 1000 characters. Empty — "To open the bot and get the materials, tap the button below 👇".

## The "+" reply and the 24-hour queue {#plus-reply}

- If you have already chatted with the person, the second message goes out almost right after the first; no need to wait for a reply.
- If there was no conversation yet, the second message waits for their first reply in Direct. "+" or any word will do.
- The wait lasts 24 hours. If they reply later, the second message for this comment won't go out; let the person comment again or write the code word in Direct.
- If a person commented on several reels in a row, after their reply the second message comes only for the latest video. Promises for older ones are closed so as not to flood them with buttons.
- Only one second message goes to a conversation within half an hour, however it is sent — there are no duplicates.
- If the rule was turned off or deleted while the person was waiting, the second message won't go out.

## Public reply under the comment {#comment-reply}

An optional public reply under the comment, for example "Replied in DM 💬". Add 2–3 variants with the "+ Another variant" button (up to five): replies alternate and don't look like spam.

## If the DM could not be delivered at all {#unresolved}

A public reply asking the person to write to you first, for example "Message us in DM and we'll send the materials 🙌". When the person writes themselves, Direct is open and you can reply to them.

Works only for rules on a specific post and only in the 15-minute backup check: when the message got through neither as a reply to the comment nor into an existing conversation.

## 15-minute backup check {#backup}

Instagram sometimes misses comments. So every 15 minutes the system compares the comments under posts with what was sent and sends the same first text to those missed (and with two steps — the second message too, following the rules above).

- Only enabled rules on a specific post are checked. Rules on "All account posts" and on story replies aren't caught up.
- The comment must be older than 5 minutes and no older than 6.5 days.
- Instagram doesn't accept replies in a thread (a reply to someone else's comment).
- If replying to the comment failed, the system tries once to write into an existing conversation with the person. Then your public reply appears under the comment, if one is set. If nothing got through, a request to write first is posted (the "If the DM could not be delivered at all" field).
- No more than 5 messages are sent per pass; the rest go in the following passes.

## When Instagram refuses {#refused}

Sometimes a message won't go out no matter how hard you try:

- the comment is more than 7 days old;
- it's a reply in a thread, not a standalone comment;
- Instagram itself has blocked replies to this comment;
- an old conversation where the person hasn't written for a long time: Instagram's reply window is closed, and a regular message doesn't get through.

In such cases a public reply asking the person to write to you in Direct works better.

## Catch-up sending by comments {#catchup}

If the rule under a post went silent (it was turned off, broke, the post changed), here you can see who didn't get the message and send it manually — up to 25 people at a time.

1. Choose the post (and the account, if there are several).
2. Click "Load comments". Each will have a status: "your reply", "DM sent", "DM failed", "no keyword match", "no rule", "missed".
3. Select people (the "all" and "none" buttons). "Missed" and "DM failed" comments that can still be replied to are selected right away.
4. Check the "DM text" — the rule's first message is filled in there.
5. Click "Send DM (N)". If the rule is two-step, the second message goes out as usual: right away or after the person replies.

"Reply publicly (N)" is a separate action with its own text from the "Public reply under the comment" field.

If there is no enabled rule under the post, "missed" statuses aren't counted.

## Backup sends {#fallback-journal}

A log of what the 15-minute backup check sent: status, time, comment number and the marks "via conversation" (went into an existing conversation), "+ public reply", "+ asked to message". The card appears only when there have been such sends. Nothing to click here — it's for checking.

## Common mistakes {#mistakes}

- A post without a rule with "Buy". Lots of comments under it, but no orders. Make a rule for this post and add "+ Product".
- The wrong product. The rule points to a product that isn't in the post — the buyer gets "Buy" for something else. Pay attention to the warning "The product “…” is not mentioned in the post “…”".
- A rule turned off "for a while" and forgotten. A disabled rule sends nothing, and people waiting for the button won't get it.
- A person "got nothing". Most often the message is in the "Requests" folder. The bot tells them this under the post itself, and you can check the "Trigger history".
