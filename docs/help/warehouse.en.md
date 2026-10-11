# Warehouse: goods in, write-offs, stocktake

keywords: warehouse, stock, inventory, goods in, incoming, write-off, defect, stocktake, recount, suppliers, supplier order, stock journal, slow-moving stock, unit cost, sklad

group: guide

order: 130

pages: /admin/warehouse

Tracking of stock movement for physical products: suppliers, goods in, write-offs, stocktake, supplier orders and the journal. Where to find it: "Menu → Catalog → Warehouse". The section exists if the warehouse module is connected. The accountant sees only the "Stock journal". Every stock change stays in the product's history.

## Suppliers {#suppliers}

Who brings what: supplier contacts. "Add supplier", "Save". A product's main supplier is chosen in the product's own card. When a supplier is deleted, they are removed from all their products.

## Goods in {#receipts}

Goods from a supplier ("Receipts").

1. Press "New receipt", add products, the "Quantity" and the price.
2. "Save draft" — you can come back later, the stock does not change yet.
3. "Post" — the products' stock increases.

A posted receipt cannot be changed — fix a mistake with a write-off or a stocktake. "Delete draft" deletes an unposted receipt. Lines with products whose stock is not tracked are skipped.

## Update cost price by weighted average {#update-cost}

A tick in the receipt. On — when posting, the product's unit cost is recalculated: (stock × old cost + incoming × price) ÷ (stock + incoming). A variant has its own. Off — the unit cost does not change.

## Write-off {#writeoffs}

Defect, loss, "personal use", other. Choose the product, the "Quantity" and the "Reason" ("Defect", "Loss", "Personal use", "Other"), press "Write off" and confirm. Stock decreases, and the loss is counted at unit cost. A write-off cannot be undone.

## Stocktake {#stocktake}

Enter the actual stock for products and press "Confirm". Confirmation adds the difference "counted minus on record" to the stock rather than replacing the stock with the number: orders that came in during the count are not lost. A confirmation cannot be undone.

## Stock journal {#journal}

All stock changes: goods in, write-offs, stocktakes, orders and edits. The "Reason" filter, "Apply", "Download CSV". Goods in, write-offs and stocktakes are kept permanently, other movements — for 180 days.

## Supplier orders {#requests}

What to order: products that are running out, and a forecast, by supplier. Enter "Order, pcs" and press "Create order". "Copy text" or "Download CSV" — and send it to the supplier yourself: the system does not send orders. From an order you can create a draft receipt and correct the actual quantity.

## Slow-moving stock {#stale}

Products in stock that have not sold for the chosen number of days, and how much money is frozen in them (at unit cost). New products younger than that are not shown. "Create offer" starts a discount on the selected products.
