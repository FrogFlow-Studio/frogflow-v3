# Settings: shop

keywords: settings, shop, shop name, currency, time zone, storefront, website, color, points, loyalty, public offer, about the shop, design, marketplace, watermark, weekly report, automatic messages, instagram notices
group: guide
order: 400
pages: /admin/settings

The "Payment and settings" page gathers all shop settings. Topics are on the left, search by setting name is at the top; every card has a "?" in the corner that opens its description. This article covers the "Shop" topic: name, storefront, legal pages, reports and service messages. Where to find it: "Menu → Settings → Payment & settings" (for bakeries and flower shops it is "Payment & delivery", for a consultant without sales just "Settings").

The page is visible to the owner and administrators. They can change almost everything; payments, the team, the API key, data export and shop deletion are changed by the owner only. If a card was changed recently, it moves to the top with the mark "Changed recently".

## Shop {#shop}

The main card: what the shop is called and how to contact it. All fields are saved with one "Save" button at the bottom of the card.

## Name and Telegram ID {#shop-name}

"Name in the bot" is the shop name in the Telegram bot, on the storefront and in link previews. Empty means the name the shop was registered under on the platform.

"Telegram ID for order notifications" is who the bot sends new order and receipt cards with "accept" and "reject" buttons to, plus all other notifications. You can enter several IDs separated by commas and a group ID. The owner always gets notifications. A person finds out their ID with the /id command in your bot. For the bot to be able to write to a person, they must press "Start" in the bot at least once. You can check that notifications arrive with the "Check notifications" button in the "Notifications" section (the "Bots" topic).

## Currency and time zone {#shop-currency}

"Shop currency" is the default currency for new products, payment details and the storefront; the minimum order amount, the free delivery threshold and the wrapping price are also set in it.

"Time zone" is used for pickup dates, closed days, quiet notification hours, bot working hours, reminders and exports. Empty means "same as the platform (Almaty)".

## Storefront: tagline, color, checkout on the website {#shop-storefront}

"Storefront tagline" is one line under the shop name on the website. Empty means it is taken from "About the seller".

"Storefront color" is a checkbox and a color picker. Checked: storefront buttons and accents use your color, on top of the design theme. Unchecked: the platform color.

"Checkout on the website" (available with the "Public web storefront" module). On: the buyer pays for digital products right on the storefront using the payment details of their country, uploads a receipt, and the materials open on the order page. Off: orders cannot be placed on the website.

"Buyer login with Telegram on the storefront" is a "Sign in with Telegram" button on the website; orders from the website and from the bot then meet in one customer card. Before turning it on, send /setdomain to @BotFather, choose the shop bot and enter the storefront address. Without this the button shows the error "Bot domain invalid": the platform cannot check this for you. It works together with checkout on the website.

## "Contact the seller" link {#shop-contact}

A link, for example to your Telegram, that the bot shows for the "Contact" button. Empty means the bot replies that no contact is set. For a price-list consultant the link is added to the "I will pass your question to a manager" reply.

## Points per purchase {#shop-loyalty}

The fields are visible with the "Loyalty program" module.

"Points per purchase, % of order total" is how many percent of the order come back as points. Points are credited after the order is delivered; 1 point = 1 unit of currency when paying for the next order. The default is 5.

"Pay with points at most, % of order total" is the cap on paying with points. 100 means the whole order can be paid with points. The buyer pays the rest as usual.

## Language of materials {#shop-lang}

The field is visible with the "Multi-language" module.

- "Ask on delivery": in Telegram the bot asks for the language with a button for each item on delivery; in Instagram and WhatsApp the buyer gets all languages.
- "Ask before checkout (priced for all languages)": the buyer picks the language already in the cart and can take "all languages": then the item costs as many times more as the product has languages.

## Instruction and delivery note {#shop-texts}

"Instruction text for the customer" is the bot's reply to the "Guide" button in Telegram. Empty means the standard text for your niche.

"Note in the delivery message (Instagram, WhatsApp)" is the last paragraph of the "order delivered" message in Direct and WhatsApp, for example "If you did not manage to download the files, resending is paid". Empty means "If there is no email, check the Spam folder and write here, we will help." The field is visible if Instagram or WhatsApp is connected.

## Legal pages {#legal}

Available with the "Legal pages" module. Four texts: "Public offer", "Privacy policy", "Seller details", "About the seller". They are shown in the bot under the "Information" button and on the storefront. An empty text means the page is hidden.

The "Insert the online school template (Russia)" button next to the offer and the policy fills the field with a template (if there is already text, it asks first). The template is a starting point: fill in the data in square brackets and show the text to a lawyer. The template is saved only with the "Save" button.

When the offer or the policy is published, the buyer on the website ticks a consent checkbox, and in the bot sees a line about accepting it when paying.

## About the shop (storefront page) {#about}

Your words for the "About the shop" page on the storefront: "Shop description", "Phone", "Address", "Opening hours", "Delivery", "Payment". Buyers also see recent approved reviews there. Until something is filled in, the page does not exist. Search engines get information about the shop from these fields.

The "My storefront as a buyer" button opens your storefront in a new tab the way buyers see it.

## Storefront design {#design}

Changes are visible to buyers right after "Save".

- "Theme": "Fresh", "Warm" or "Classic". Your own "Storefront color" from the "Shop" card stays on top of the theme.
- "Shop cover": a large picture above the catalog, the photo of the first product on sale. Until there is a photo, the cover is not shown.
- "Photo shape in the catalogue": "Square" means the photo fills the square and the edges of portrait photos are cropped; "Portrait 4:5" means the card is taller and a 4:5 photo is visible in full; "Whole photo" means any photo is fully visible inside the square, and the free space is background.
- "Home blocks": "New arrivals", "Best sellers", "Sets", "Reviews". Ticked blocks go above the catalog in the chosen order (arrows ↑ and ↓). Buyers do not see an empty block. "Best sellers" are products with approved reviews.

## FrogFlow marketplace {#marketplace}

The shared catalog of FrogFlow shops, where buyers find shops on their own. The marketplace shows only the name, category, city and a link to the storefront; orders, amounts and customers do not get there.

"Show on the FrogFlow marketplace" is your consent. After it the shop waits for operator approval; the status is written under the form ("waiting for operator approval", "shown on the marketplace", "hidden by the operator"). Off by default. "Marketplace category": empty means the shop's niche. Below is a counter of visits from the marketplace to your storefront.

## Authors community {#community}

A profile for the [community](/admin/community), a place where platform authors share experience.

"Show me in the community": while it is off, other authors cannot see you, and you yourself cannot read or write in the community. Turn it on, fill in "Name", "Niche", "City", "What I do", "Links" and press "Save". Shop data (orders, amounts, customers) does not get into the community.

"Shop recommendations": tick a few shops you recommend. A recommendation is visible on storefronts and author pages only when it is mutual: when that shop has ticked you too. Remove the tick and it disappears for both.

## Protect PDFs from resale {#watermark}

The switch turns on a watermark on delivered PDFs: every page shows who bought it (name in Latin letters, @username or email) and the order number. The original in the catalog does not change. Off: PDFs go out without a mark. Off by default. Saved immediately.

## Gift wrapping {#gift-wrap}

Available with the "Bundles and gifts" module, for physical orders only.

- "Offer to place the order as a gift": the buyer sees the "This is a gift" button in Telegram and on the website; in Instagram and WhatsApp the bot asks about it before checkout. Off: there are no gift marks.
- "Offer gift wrapping": a buyer who marked a gift can add wrapping.
- "Wrapping price": a separate line in the order total, in the receipt and in the log; a promo code does not discount it.

## Smart catalog search {#smart-search}

Available with the "Smart catalog search" module. When the regular search in the bot or on the storefront finds nothing, a query like "something for a five-year-old's birthday" is matched by meaning with AI.

The switch turns the search on (off by default). Each call costs money and is charged to the [AI balance](/admin/ai-balance); the limit is 200 calls a day per bot and no more than once every 45 seconds per buyer. Below are the calls and spending for today and in total. If no AI key is set on the platform, the switch is unavailable.

## Weekly report {#weekly}

Every Monday at 9:00 the bot sends you last week's results in the admin panel language. The switch is on by default; turn it off and the report does not come.

The checkboxes below choose what to add to revenue and orders: "Payment and delivery speed", "New and returning customers", "Funnel and best channel", "Top products". Saved immediately. Until the shop has sales, the report is not sent.

## New automatic messages {#auto-v3}

The switch turns on three automatic messages to buyers: a request for a rating a few days after delivery, a "the promotion ends tomorrow" reminder and a cart reminder in Instagram and WhatsApp. Once an hour it also sends "The product is back" to those on the waiting list who did not get the message right away.

Messages go only to those the shop is allowed to write to, and no more than one marketing message a day. Each also depends on its own module. Off (the default): none of this is sent to buyers.

## Service notices from Instagram and WhatsApp {#service-notices}

Messages the bot sends you in Telegram about chats in Instagram and WhatsApp. Turning them off changes nothing for buyers. Orders, receipts and complaints are not included here: they are in the "Notifications" section.

- "A buyer sent a photo and no order is waiting for payment": on by default.
- "Bot paused in a dialogue: you replied to the buyer yourself": on by default.
- "A buyer sent a phone number in the chat": on by default.
- "The bot replies "Got your number"": this is not a notice but a reply to the buyer. Off by default: the bot's reply marks the chat as read, and the number is easy to miss.
