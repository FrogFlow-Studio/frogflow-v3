# Discounts: promo codes, gift certificates, referrals and sales

keywords: discount, discounts, promo code, promocode, coupon, discount code, certificate, gift certificate, gift card, referral program, invite a friend, loyalty levels, cashback, sale, limited offer, promotion
group: guide
order: 220
pages: /admin/discounts

Here you create promo codes and gift certificates, set up friend invitations, loyalty levels and temporary sales on products. The buyer enters promo codes and certificates in the bot cart. Where to find it: "Menu → Marketing → Discounts". Each card is visible only if its module is on.

## Promo codes {#promo}

"+ Promo code" opens the form. Managers and above can edit and delete promo codes.

- "Code" — what the buyer enters in the cart.
- "Type": "Percent" or "Amount" (a fixed discount in money).
- "Value" — how many percent or what amount.
- "Usage limit" — how many times in total the code can be used. Empty — no limit.
- "Valid until" — after this date the code is not accepted.

Badges in the list: "off", "expired", "used up", "1 per buyer".

## Active {#promo-active}

The "Active" checkbox. On — the code is accepted in the cart. Off — the code doesn't work but stays in the list, and you can turn it on again.

## Once per buyer {#promo-once}

The "Once per buyer" checkbox. On — one buyer can use the code only once. Any of their orders with this code counts as a use, except cancelled and rejected ones. On the website the buyer is also recognized by the order email. Off — one buyer can use the code any number of times until the overall limit is used up.

## Gift certificates {#gift}

Enter the "Amount", the "Currency" (check it — tenge is the default) and, optionally, "For / note". Click "Issue" — a certificate code appears, give it to the buyer. "Cancel" makes the code invalid.

## Selling certificates on the website {#gift-sale}

The "Sell gift cards on the website storefront" checkbox. On — a certificate can be bought on the storefront in one of the amounts from the "Amounts, comma-separated (up to 6)" field. The buyer pays as for a regular website order. The code is created only after the payment is confirmed and is delivered to the order page and by email. Website checkout must be on and there must be a payment method in that currency. Off — certificates are not sold on the storefront.

## Referral program {#referral}

The buyer shares a link from the "🎁 Invite a friend" item in the bot menu. The invited person immediately gets a one-time promo code for their first purchase, and the inviter gets the same after the friend's first delivered purchase. These codes (WELCOME-… and REF-…) appear in the promo code list.

"Promo code discount, %" — the discount size for these codes. Only the shop admin or owner can save it.

The "Referrals" report shows totals for 30 days and for all time; "Download CSV" exports the table.

## Loyalty levels {#tiers}

The buyer earns points at their level's percentage. The level is based on the total of their delivered orders in the shop currency, counted up to the current order. Below the first threshold, the general earning percentage from the settings applies. Points already earned don't change. The buyer sees their level and how much is left to the next one in the bot cart.

For each level: "Name", "From amount", "Earn, %". "Add level", "Remove", then "Save levels".

## Limited offers {#offers}

A discount on a product or a whole category until a date. The discounted price shows right away in the bot, in Direct and on the storefront; times follow the shop's clock.

1. "Applies to": "Product" or "Category", then choose the product or category.
2. "How to price": "Percent off" or "New price" (for a category — percent only).
3. "From (empty — now)" and "Until" — when the sale runs.
4. "Units (optional)" — how many units to sell at the sale price.
5. Click "Launch".

In the list of sales:

- "Invite buyers" (available with the broadcasts module) — once per sale the bot writes about it to everyone in Telegram who hasn't unsubscribed, with a product or catalog button. A day before the end, one reminder goes to those who got the first message.
- "End now" — prices go back to normal immediately.
- "Edit" and "Delete".

From the "Slow-moving stock" report you can jump straight here with the products selected.
