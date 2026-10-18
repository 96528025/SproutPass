# NEEDS — requests across agents/people (append only; owner replies inline)

## B1 (rules & demo)
## B2 (closet functions)
## B3 (trade functions)
## B4 (app shell & bag)
## B5 (listing & trade UI)
## To A (pixel kit)
- DialogBox needs `onChoose(value)` for `choices`; Modal is rendered conditionally by callers and takes `onClose?`.
## To C (agents & messages)
- Frontend-callable function `suggestCondition { imageUrl } → { condition?, note? }` (B4 wires it in api.real.ts).
