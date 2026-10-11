# Settings: advanced

keywords: crm, amocrm, bitrix, google sheets, integration, api, api key, data export, archive, take my data, delete shop, deletion
group: guide
order: 450

The "Advanced" topic on the [Payment and settings](/admin/settings) page: the link with your CRM and spreadsheets, an API key for developers, exporting all data and deleting the shop.

## CRM and Google Sheets {#crm}

Available with the "CRM and Sheets integration" module; changed by the owner and administrators. Order events go to your address: an amoCRM or Bitrix24 incoming address, a Google Apps Script web app, Make, Zapier.

1. Paste the address from your CRM or spreadsheet into the address field (https only). Empty means the integration is off.
2. "Signing secret" is optional: then every event is signed, and your system can check that it came from the shop. When a secret is set, the field is empty; enter a new one to replace it.
3. "Events to send": tick the ones you need: order placed, receipt received, order delivered, delivery failed, order rejected, status changed, payment received, refund, handed to courier.
4. Press "Save", then the check button next to it: a test event goes to the address, and the card shows the reply.

## Delivery log and retry {#crm-log}

Under the form are the last 100 sends: event, order, your server's reply and time. If the server did not reply within 10 seconds or replied with an error, the event is not retried automatically, because it may have arrived. Look in the CRM, and if the event is not there, press "Retry": it goes again with the same event number, and the CRM can drop the duplicate. If there was no connection, the platform retries by itself.

## Developer API {#api}

Available with the "Developer API" module; owner only. The key gives your accounting system access to the shop's orders, products and customers. Keep it like a password: whoever has the key sees orders with customer contacts.

1. Choose "Key permissions": "Read and edit products (stock, prices)" or "Read only".
2. Press "Create key" and copy it right away: it will not be shown again.

"Issue a new key": the old one stops working immediately. "Revoke key": integrations using it stop working. The card shows when and from where the key was last used. Real-time order events are sent by the CRM integration (the section above).

## Take my data {#takeout}

Owner only. "Get a link to the archive" creates a link to a ZIP archive: orders and their items, customers, the catalog (tables for Excel) and shop settings without passwords and tokens. "Download the archive" uses the link. The link is valid for 24 hours.

The archive contains your customers' contacts, and anyone who has the link can download it, so do not forward it to outsiders.

## Delete the shop {#delete}

Owner only.

1. Press "Delete the shop…".
2. Enter the shop name to confirm.
3. Press "Delete in 30 days".

The shop is paused right away: the bot replies with the pause message, and the storefront closes. For 30 days you can bring it back with the "Restore the shop" button in the banner. After that the shop goes to the archive, and photos, files and receipts are deleted. Orders are kept for accounting.
