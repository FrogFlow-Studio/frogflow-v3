# Products and the product card

keywords: products, catalog, product card, price, price by country, price for russia, rubles, prodamus, files, materials, on sale, hide a product, stock, pre-order, variants, bundle, import, excel, csv, google sheet, from instagram, course, tovary

group: guide

order: 100

pages: /admin/products, /admin/ig-import

The list of all the shop's products and the card where you set the price, files, photos, stock and variants. Where to find it: "Menu → Catalog → Products" (in an online school — "Courses"). Any employee except the accountant can view it; a manager and above can change things.

## Product list {#list}

Columns: "Name" (type, number of variants, stock), "Categories", "Price", "Stock", "Readiness", "Lasts for", "Files", "Languages", "Added", "On sale". "Show more" loads the next products.

"Lasts for" is the stock divided by average sales over 30 days (cancelled orders are not counted). "—" means there were no sales.

## On sale {#on-sale}

The switch in the last column of the list and the "On sale" tick in the card are the same thing. On — buyers see the product in the bot, the Mini App and the storefront. Off — the product is hidden: it cannot be bought, but the card, files and past orders remain. If the product was out of stock and a waiting list is connected, after switching it on the waiting buyers get a message that the product is on sale again.

## Filters and order {#filters}

- The "Name or keywords" search, "All categories", "hidden only", "No topic".
- "Order": "As in catalog", "Newest first", "Oldest first", "By name", "By price". The choice is remembered in this browser.
- In "As in catalog" mode without filters you can drag rows — this changes the order of products for buyers.

## Material language {#lang-filter}

The "Material language" list: "Has …" or "No …". "No …" shows digital products without a file in that language — handy for finding what is not translated. Physical products and courses are not included.

## Actions on several products {#bulk}

Tick products or use "Select all on this page"; "Select all … matching the filter" takes all products under the filter. Before applying, the panel asks for confirmation. Actions:

- "Show" and "Hide (archive)" — switch on or hide from the storefront. There is no deletion: the card, files and orders remain.
- "Add to category" or "Only this category" (replaces all of the product's categories).
- "Create a promotion" — for the selected products, no more than 20 at a time.
- "Set topic", "Remove topic".

Result: "Changed: …, skipped: …" with reasons. If a product was being edited in its card at that minute, it is skipped rather than overwritten.

## Price and stock for several products {#bulk-price}

- "Price, % (for example 10 or -15)" and "Change price" — changes the base price, country prices and variant prices by this percentage.
- "Stock, pcs" and "Set stock" or "Add to stock". Each change is visible in the report and in the product's stock history.

## Catalog import and export {#import}

The "Import / export" button. In the "Catalog import and export" card:

1. "Download catalog (CSV)" — the current products as a table.
2. "Choose CSV or Excel" — upload a table (the first sheet). Columns: Name (required), SKU, Price, Category, Description, Stock, Photo (links separated by spaces, up to 5).
3. Check what will be created and updated, and the rows with errors.
4. Press "Apply import".

A product is matched by SKU, and if there is none — by name, so uploading again does not duplicate anything.

## Catalog from a Google Sheet {#sheet}

Paste the "Sheet link" (give it "Anyone with the link" access, viewer), press "Check", then "Load and update every night". The columns are the same as for import. The catalog is updated from the sheet every night; "Update now" — right away. Below you see when and what was updated. "Disconnect" unlinks the sheet; the products stay as they are.

## Hide products that are not in the sheet {#sheet-hide}

With the tick on, a product that disappeared from the sheet is hidden (not deleted, it can be shown again). If more than half of the products disappeared from the sheet, the system will not hide them — that looks like a mistake in the sheet.

## The sheet wins {#sheet-overwrite}

The "The sheet wins: overwrite what I edited in the admin panel" tick. Off — the nightly update does not touch fields you edited in the panel. On — the sheet overwrites them. The sheet never changes photos and does not delete products.

## Products from Instagram posts {#ig-import}

The "From Instagram" button in the list (if Instagram is connected, for a manager and above). The name, price and description are taken from the post caption, the photo — from the post.

1. Choose the "Product type" — "Physical" or "Digital" — and the "Category".
2. Tick posts and adjust the "Name" and "Price" ("no price in the caption" — enter it yourself).
3. Press "Create products".

Products are created hidden: check them in the catalog and switch on "On sale". Add a file to a digital product.

## Shop template {#shop-kind}

In an empty shop a "Shop template" is offered above the list: "Digital materials", "Products with delivery" or "Services and courses". The template creates categories, the texts of the "About the shop" page and delivery and payment settings. Texts and settings you have already written are not changed.

## Broken "Suggest with this" rules {#upsell-health}

If upselling is connected and the rules contain hidden or deleted products, a card appears above the list. A hidden product returns to the suggestions when it is shown again. "Remove deleted" cleans deleted products out of the rules.

## Product card {#editor}

Opens from the name in the list or with the "+ Product" button. The sections go in a row: "Basics", "Photos", "Price", "Stock", "Variants", "Bundle", "Promotion"; on the left are the contents and "Card readiness" — what is missing for the card to be easy to buy from. At the bottom is the "Discard" and "Save" bar. The panel will not let you leave with unsaved edits without confirmation.

- "Duplicate" creates a copy of the product marked "— copy" and opens it.
- "Delete" deletes the product together with its files. Orders with it are kept.
- "Instagram post" opens a post with this product (if Instagram is connected).

## Name, description, keywords {#name}

- "Name" — required.
- "Description" — shown in the product card. "✨ Write with AI" writes a draft into the field from the name, price and your notes; "Restore my text" undoes it.
- "Search keywords" — separated by commas: synonyms, grade, subject. A short word from here works as a code in Instagram and WhatsApp: the buyer writes «#кпп» — the bot shows the product.
- "Topic (for “Similar”)" — the main word of the material; similar products are picked by it. The buyer does not see the topic, but search finds it.
- "Categories" — where the product sits in the catalog. Without categories the product is shown on the first screen.

## Product type {#kind}

- "Digital: files after payment" — after the payment is confirmed, the bot sends the buyer the files itself.
- "Physical: delivery or pickup" — the order goes through the "accepted", "in progress", "ready", "delivered" steps, and the buyer is asked for the date of receipt and delivery.

## This is a course — lessons instead of files {#is-course}

The tick is on a digital product if learning is connected. On — a file is not required: after payment the buyer gets a link to the lessons. Lessons and assignments are added below after saving; without lessons the course does not appear in the catalog.

## Material files {#files}

The "+ Русский", "+ Қазақша" buttons (and English and Uzbek when multilingual mode is connected) upload files in that language: PDF, ZIP, video up to 200 MB. You can change the language of each file or delete it with "✕". The buyer gets all files in their language.

A digital product without a file will not be saved: "otherwise the buyer pays and gets nothing". The exception is a course.

"Product preview" — up to 5 pictures (workbook pages, lesson covers): the buyer sees them on the storefront and via the «👀 Пример» button in the bot.

## Base price, currency, position {#price}

- "Base price" — required. Buyers for whom there is no separate country price see it.
- "Currency" — three letters, the shop currency by default.
- "Position in list" — the smaller the number, the higher the product.

## Price for Russia, ₽ {#ru-price}

The field appears when Russian card payment through Prodamus is connected and there is no "Russia" payment country in the settings. The bot shows this price next to the tenge price: «К оплате: 1700 ₸ / ≈470 ₽». Buyers from Russia pay with a Russian card through Prodamus; there is no need to add "Russia" as a country. Empty — no ruble price is set.

## Price by country {#country-prices}

"Country, currency" fields appear if multi-currency is connected and there are countries in the [payment settings](/admin/settings). Each payment country has its own price in its currency. Empty — the price is converted from the base price at the exchange rate. If there are no countries, the card suggests "Add payment countries".

## Unit cost and subscription {#cost}

- "Unit cost" (if profit tracking is connected) — how much the product costs you; profit is calculated from it. More in [Cost](/admin/cost).
- "Subscription" (if the subscriptions module is connected): the "Sold as a subscription" tick and "Renew every, days". That long after payment the bot reminds the buyer to renew. There is no automatic charge: the buyer pays for the renewal like an ordinary order.

## Stock {#stock}

The "Stock" field. Empty — stock is not tracked, the product is sold without limit. At zero the product cannot be bought (unless pre-order is on). Under the field you see how many buyers are waiting for a restock and how the last message to them went: when the stock goes above zero and you save the card, they get a message. Every change is written to "Stock history".

## Warn when no more than this is left {#low-stock}

The threshold for this product: when stock drops to it, the product goes into "To do today". Empty — the shop's common threshold; 0 — do not warn.

## Production time, days {#lead-time}

For physical products. The buyer cannot choose a date of receipt earlier than this.

## Accept pre-orders when out of stock {#preorder}

A tick on a physical product with stock tracking. On — while there is not enough stock, the product can still be ordered: stock does not go negative, the whole line goes as a pre-order. The buyer sees "pre-order" and the shipping date. Off — it cannot be bought without stock.

"Ships from (date)" — the buyer sees this date; empty — "date to be confirmed". If you move the date, buyers with open orders get a message about the new date.

## Supplier and stock history {#supplier}

"Supplier" (if the warehouse is connected) — the product's main supplier from the [Warehouse](/admin/warehouse) section. "Stock history" — where units went and where they came from over 30 days, and who did it.

## Photos {#photos}

"+ Add photo". The first photo is the cover; change the order with the arrows.

## Variants {#variants}

Variants like "1 kg", "2 kg" with their own price — it replaces the base one. For a course these are tariffs ("Self-study", "With homework review"). "+ Variant" adds a line, "✕" deletes it.

## Bundle {#bundle}

If bundles are connected, on a saved physical product. The "This is a bundle" tick: the product becomes a bundle of other physical products with its own price (the price is in the "Price" section). Add products and "Qty", and press "Save". You see how much the buyer saves and how many bundles the stock allows. A bundle is not available to buyers while it contains a hidden or deleted product.

## Suggest with this {#upsell}

If upselling is connected. The bot shows these products in the cart when this one is there. Empty — popular ones from the same category.
