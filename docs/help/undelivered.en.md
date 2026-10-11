# Undelivered: messages that did not arrive

keywords: undelivered, not delivered, did not arrive, message not sent, sending error, retry, queue, buyer did not get it, notification did not come, ne dostavleno

group: guide

order: 80

pages: /admin/undelivered

Messages to buyers and to you that did not go out the first time. Where to find it: the "Undelivered" item with a red number appears in "Menu → Sales" and in "Waiting for you" on the overview, only when such messages exist.

## How the system retries by itself {#auto-retry}

The system retries an unsent message by itself five times with a growing pause. What still did not arrive after that gets into the list. The "State" column shows "retry …", "sending" or "undelivered after … attempts", as well as how many attempts there were and the last error. "What" shows the text and the order number, if the message is about an order.

Sends to external accounting systems that broke off or got a failure on their side are not retried by themselves: they may have arrived. They are retried from the delivery log in the [settings](/admin/settings).

## Retry {#retry}

"Retry" resets the attempt counter, and the message goes out within the next minute. Before retrying, check the reason in "last error": for example, if the buyer blocked the bot, a retry will not help.

## Dismiss {#dismiss}

"Dismiss" removes the message from the list, and it will no longer be sent. Use it if you have already written to the buyer yourself.

The buttons are for a manager and above. When everything is delivered, the page says "Everything delivered."
