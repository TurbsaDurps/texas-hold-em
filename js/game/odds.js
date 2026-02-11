import { createDeckExcluding, shuffle } from "../core/cards.js";
import { bestScore } from "../core/evaluator.js";

export function estimateAllInOdds(playerEntries, communityCards, trials) {
  const odds = {};
  const totalTrials = Math.max(1, Math.floor(trials || 1));
  if (!playerEntries.length) return odds;

  const known = getKnownCards(communityCards, playerEntries);
  const baseDeck = createDeckExcluding(known);

  const winShares = new Map();
  for (const entry of playerEntries) {
    winShares.set(entry.seat, 0);
  }

  for (let t = 0; t < totalTrials; t += 1) {
    const deck = shuffle([...baseDeck]);

    const community = [...communityCards.filter(Boolean)];
    while (community.length < 5) {
      community.push(deck.pop());
    }

    let best = -1;
    let winners = [];
    for (const entry of playerEntries) {
      const full = [...entry.player.holeCards, ...community];
      const score = bestScore(full);
      if (score > best) {
        best = score;
        winners = [entry.seat];
      } else if (score === best) {
        winners.push(entry.seat);
      }
    }

    const share = 1 / winners.length;
    for (const seat of winners) {
      winShares.set(seat, winShares.get(seat) + share);
    }
  }

  for (const [seat, wins] of winShares.entries()) {
    odds[seat] = wins / totalTrials;
  }
  return odds;
}

function getKnownCards(communityCards, playerEntries) {
  const known = [];
  for (const card of communityCards) {
    if (card) {
      known.push(card);
    }
  }
  for (const entry of playerEntries) {
    for (const card of entry.player.holeCards) {
      if (card) {
        known.push(card);
      }
    }
  }
  return known;
}
