# The buyer wants to pay via Kaspi

keywords: kaspi, kaspi pay, kaspi transfer, pay with kaspi, apipay, kazakhstan, kaspi qr, kaspi link does not open, kaspii, kaspi gold
group: trouble
order: 70

There are two ways to accept Kaspi: a transfer by phone number or QR with a receipt (works for everyone) and automatic payment through ApiPay (needs to be connected).

## Kaspi transfer with a receipt {#transfer}

1. In [Payment and settings](/admin/settings#payment-methods) add the country "Kazakhstan" with your Kaspi number or QR in "Payment details and instructions" and turn on "Active".
2. The buyer sees the details, makes the transfer and sends a screenshot of it from the Kaspi app.
3. You check that the money arrived and confirm the order in [Orders](/admin/orders).

If the buyer writes "I don't know how to send the receipt": in the Kaspi app open the transfer, press "Share" or take a screenshot, then in the conversation press the paper clip and send the picture.

## Automatic payment through ApiPay {#apipay}

With ApiPay the buyer gets a "Pay with Kaspi" button, pays in the app, and the order is confirmed and delivered by itself, without a receipt. You need your own organization in ApiPay with a connected cashier. The key and secret are entered in the "Kaspi: ApiPay" block in [Payment and settings](/admin/settings#kaspi); the shop owner sees the block when the module is connected.

## The Kaspi link does not open {#link}

Ask the buyer to copy the link and open it in a browser or in the Kaspi app. If that does not work, offer a transfer by number with a receipt.

## A buyer from Kyrgyzstan or Russia {#abroad}

Kaspi transfers from other countries do not always go through. For Russia see [A buyer from Russia](/admin/help?a=buyer-russia); for other countries add their payment details as a separate line in the payment methods.
