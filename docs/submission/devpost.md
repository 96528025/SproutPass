# SproutPass

## Problem, user and solution

Children outgrow clothing quickly. Parents often keep usable clothes in drawers because photographing, listing, answering questions and coordinating a handoff takes effort. Another family nearby may be searching for the same garment in the next size.

SproutPass is for parents and caregivers who want an easier way to pass children’s clothes to another family. Each family has a pixel pet that helps maintain a clothing inventory, understand shared needs and find compatible items. A parent can send a garment photo in iMessage; Base44 identifies visible details and saves the item. Unknown size and original price are confirmed with the parent rather than invented.

The agents check garment size, category, budget and fit, then present a clear listed-price offer. Sharing a listing authorizes the seller’s agent. Only the buyer approves the final offer. An explicitly labeled Visa simulation runs, the inventory ownership changes, and connected iMessage chats receive a receipt and product image.

## Built substantially with Base44

Base44 hosts the live app and persists families, garments, needs, listings, encounters, proposals, ownership histories and feedback. Backend functions implement matching and approval, AI integrations analyze photos and conversational needs, and realtime subscriptions keep the screens in sync. Photon connects private iMessage conversations to those workflows.

## What we learned and changed

- Registering a family in our database did not connect their phone to Photon. We added the missing shared-line assignments and now show whether the first inbound message has connected each family.
- A location timeout was incorrectly forcing users into demo mode. We added explicit location permission, retry instructions, and a separate demo choice.
- Requiring both people to approve added unnecessary friction after the seller had already shared the listing. The final flow asks only the buyer to approve.
- An in-app message mirror did not prove an iMessage was sent. The trial page now tracks text and image submission to Photon separately and asks demonstrators to verify arrival on physical phones.

These are engineering and demo-testing observations. Actual parent feedback will be reported only after responses are collected through the feedback form.

## Demonstration and limitations

The short demo uses a clearly labeled sample children’s garment and compatible need. The inventory, proposal and ownership changes are saved in Base44. The sample illustration and prefilled need do not count as real photo recognition or user research. Show a separate actual photo upload if demonstrating that feature.

Payments are simulated: no Visa sandbox/API, card data, real charge or funds transfer. Simulated location is labeled. The current shared Photon numbers support private messages; a live family group chat needs a dedicated line and has not been verified. The named-account picker is intended for the hackathon demonstration, not production identity security.

## Beyond the weekend

Start with a small, existing parent community, such as a preschool or neighborhood group. Observe actual listings and handoffs, improve the flow using parent feedback, and validate whether the service saves effort. Production work includes account authentication, consent and access controls, a supported payment provider, and an operational group-chat line if parents want it.

Live app: https://sproutpass-5c025059.base44.app
Demo progress: https://sproutpass-5c025059.base44.app/trial
Feedback: https://sproutpass-5c025059.base44.app/feedback
