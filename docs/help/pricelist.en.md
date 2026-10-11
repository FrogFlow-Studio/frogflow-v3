# Consultant price list

keywords: price list, pricelist, 1c, export, csv, excel, xlsx, google sheets, spreadsheet, ruble rate, prices in rubles, product photos, consultant persona, synonyms, working hours, buyer follow-up
group: guide
order: 140
pages: /admin/pricelist

Where the AI consultant takes items, prices, the ruble rate and photos from when it answers from a price list rather than the catalog. Upload a fresh 1C export — the consultant starts answering from it within a minute. Where to find it: "Menu → Catalog → Consultant price list"; in the consultant workspace — "Menu → Consultant → Price list". The page appears when the operator has turned on price-list consultant mode for you.

Any staff member can view it; managers and above can change it. In the consultant workspace this page has only the price list, Google Sheet, ruble rate and photos; tasks, the knowledge base and the consultant persona are on their own pages.

## Price list from 1C {#file}

A 1C export in CSV or Excel (.xlsx): name, section, size, color, price, stock. Items marked "не для продажи" (not for sale) are not shown to buyers.

- "Upload CSV or Excel" — choose a file on your computer.
- "Or a Google Drive link to the file" — a file open to anyone with the link; "Load from link". It is loaded once.
- If prices changed suspiciously much (for example, a column shifted), the page shows examples and asks. Check them and click "Looks right, upload" if everything is correct.

Uploading a file disconnects the Google Sheet so the automatic refresh doesn't replace your file.

## Price list from Google Sheets {#sheet}

If you keep the price list in Google Sheets:

1. Share the sheet with "Anyone with the link".
2. Paste the link into the "Sheet link" field and click "Check" — you'll see what will be added, what will disappear and where prices change.
3. Click "Load and refresh automatically".

From then on the price list refreshes from the sheet by itself every 15 minutes. The columns are the same as in the 1C export. If the sheet couldn't be downloaded, is empty or has half as many items, the previous price list stays, and the card shows the reason. "Disconnect" stops refreshing; the price list stays as it is.

## Ruble rate {#rate}

The consultant quotes prices in rubles at the bank rate. "Refresh now" fetches a fresh rate. "Manual rate" — how many tenge the bank pays per ruble, for example 4.79; "Save rate".

If the rate hasn't been updated for more than a day, the consultant quotes ruble prices marked "approximate". If there is no rate at all, ruble prices aren't quoted. You can change the rate source through [Support](/admin/support).

## Brands, website and store {#settings}

- "Brand synonyms" — one line per brand: first as in the price list, then how buyers ask for it. For example: "pip, голландские, голландия".
- "Shop website", "Store address", "Phone", "Store opening hours" — the consultant tells them to the buyer.

## Consultant working hours {#work-hours}

"Opens" and "Closes" — in the shop's time zone. Outside these hours the consultant answers as usual, but when handing a conversation to a manager it says the manager will reply in the morning, and sends no reminders. For a night shop, set opening later than closing (for example, from 22 to 6).

## Follow up with customers who went quiet {#follow-up}

A checkbox. On — in Instagram and WhatsApp, 3 hours after a reply about a product, the consultant writes one line: "Any questions about …?". Only within 24 hours of the buyer's last message (later Instagram won't allow writing), not at night, not after a manager has replied and not while a task for this buyer is open. Off — no follow-up.

## Reply quality summary {#digest}

The "Reply quality summary every morning" checkbox. On — after 9:00 a summary arrives: how many replies there were yesterday, how many were handed to a manager, remarks on prices and reply format, spend. Off — no summary.

## Reminders about open tasks {#task-reminders}

The "Remind me about open tasks in Telegram" checkbox. On — if a task isn't marked done within 2 hours, one reminder arrives (during the consultant's working hours), and at 9:00 — a list of all open tasks. Off — no reminders.

## Consultant persona {#persona}

Who the consultant says it is, what tone it writes in and what's special about your products: "Shop name", "About the shop", "Tone", "Product specifics" (one line per rule: what to clarify, how to name things, what not to offer). This doesn't override the platform rules: prices come only from the price list, and the consultant calls a manager in the same cases. "Restore the standard text" — undo your edits.

## Product photos and videos {#media}

A photo is linked to a model, not to a price list row: a photo of "Uchino Zero Twist" fits all sizes and survives a new export. The consultant sends it to the buyer when asked.

1. "Model, as in the price list" — a counter shows how many items matched.
2. "Color" — if the photo shows one color.
3. Choose a photo or video up to 25 MB and click "Add" (or "Add without matches").

Without photos, the consultant calls a manager when asked for a photo.

## Consultant tasks {#tasks}

Each handoff to a manager: a purchase, wholesale, a complaint, "call a human", an unanswered question. A task closes by itself when you reply to the buyer. More in the [Tasks](/admin/help?a=tasks) article.

## Knowledge base {#knowledge}

Articles about brands, materials, care and delivery. The consultant attaches the right one to the buyer's question and doesn't make up anything beyond it. More in the [Knowledge base](/admin/help?a=knowledge) article.

## Consultant spend, last 7 days {#usage}

How many messages the consultant handled in a week and what it cost.
