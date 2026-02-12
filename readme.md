# Texas Hold'em (Vanilla JS)

Browser-based Texas Hold'em with NPC opponents, configurable blinds, betting rounds, showdown evaluation, and all-in odds previews.

![Demo](assets/images/demo.png)

## Stack
- JavaScript (ES modules)
- HTML + Tailwind CDN classes
- Vanilla CSS

## Run Locally
1. Clone the repo.
2. Start a local web server from the project root (ES modules require HTTP, not `file://`):
   ```bash
   npx serve .
   ```
3. Open the printed localhost URL in your browser.

## Project Structure
- `index.html`: Table layout and controls.
- `js/main.js`: App entry point and event wiring.
- `js/game/`: Game flow, state, NPC AI, odds simulation.
- `js/core/`: Card/deck utilities and hand evaluator.
- `js/ui/table.js`: DOM updates and card dealing animations.
- `assets/`: Cards, logo, background, audio.

## Gameplay Notes
- Small and big blinds increase every `blindIncreaseHands` hands.
- NPC behavior is driven by expert-only AI logic in `js/game/ai.js`.
- All-in odds are Monte Carlo estimates and are recalculated as community cards appear.
