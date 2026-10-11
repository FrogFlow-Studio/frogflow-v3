# A buyer from Russia: how they can pay

keywords: russia, rf, rubles, in rubles, russian card, sbp, prodamus, from russia, russian bank card, transfer from russia, rossiya
group: trouble
order: 60

A buyer from Russia has two ways: paying with a Russian card or SBP through Prodamus (if you have it connected), or a transfer to the payment details for the country "Russia" with a receipt.

## Paying with a Russian card through Prodamus {#prodamus}

1. Connect Prodamus in [Payment and settings](/admin/settings#prodamus): the payment form address, the secret key, the checkout currency and the exchange rate.
2. If your prices are in tenge and the checkout is in rubles, be sure to set the rate: without it, orders in tenge will have no Russian card payment button.
3. The buyer sees the "💳 Russian card" button, opens the form and pays. The order is confirmed and delivered by itself.

The form accepts only cards of Russian banks. It will not accept a card from Kazakhstan or another country: such a buyer needs a different method. If the form charges in tenge, the buyer's bank debits rubles at its own rate, so the exact amount in rubles may differ slightly from the one you named. Name it as "about".

## Price in rubles for a product {#price}

For the bot to show the buyer the price in rubles next to tenge ("1700 ₸ / ≈470 ₽"), fill in the product's "Price for Russia, ₽" field in [Products](/admin/products). Without it the ruble price is not shown.

## Transfer to payment details {#transfer}

If you do not have Prodamus, add the country "Russia" with ruble payment details in [Payment methods by country](/admin/settings#payment-methods). The buyer chooses the country, sees the details and sends a receipt, and you confirm it in [Orders](/admin/orders).

## Other countries {#other}

For Kyrgyzstan, Uzbekistan and other countries add a separate line in "Payment methods by country" with payment details that work there. If there is no method for a country, the buyer cannot pay on their own: answer them in "Inbox" and agree on it by hand.
