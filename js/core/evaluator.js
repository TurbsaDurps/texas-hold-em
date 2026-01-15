export function bestScore(cards) {
  if (!cards || cards.length < 5) {
    return 0;
  }
  let best = 0;
  const n = cards.length;
  for (let i = 0; i < n - 4; i += 1) {
    for (let j = i + 1; j < n - 3; j += 1) {
      for (let k = j + 1; k < n - 2; k += 1) {
        for (let l = k + 1; l < n - 1; l += 1) {
          for (let m = l + 1; m < n; m += 1) {
            const score = scoreFive([
              cards[i],
              cards[j],
              cards[k],
              cards[l],
              cards[m],
            ]);
            if (score > best) {
              best = score;
            }
          }
        }
      }
    }
  }
  return best;
}

function scoreFive(hand) {
  const rankCounts = Array(15).fill(0);
  const present = Array(15).fill(false);
  const ranks = [];
  let flush = true;
  const suit = hand[0].suit;

  for (const card of hand) {
    rankCounts[card.rank] += 1;
    present[card.rank] = true;
    ranks.push(card.rank);
    if (card.suit !== suit) {
      flush = false;
    }
  }

  ranks.sort((a, b) => b - a);
  const straightHigh = findStraightHigh(present);

  let four = 0;
  const trips = [];
  const pairs = [];
  const singles = [];

  for (let value = 14; value >= 2; value -= 1) {
    const count = rankCounts[value];
    if (count === 4) {
      four = value;
    } else if (count === 3) {
      trips.push(value);
    } else if (count === 2) {
      pairs.push(value);
    } else if (count === 1) {
      singles.push(value);
    }
  }

  if (straightHigh && flush) {
    return buildScore(8, straightHigh);
  }
  if (four) {
    return buildScore(7, four, singles[0]);
  }
  if (trips.length && (pairs.length || trips.length > 1)) {
    const trip = trips[0];
    const pair = trips.length > 1 ? trips[1] : pairs[0];
    return buildScore(6, trip, pair);
  }
  if (flush) {
    return buildScore(5, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]);
  }
  if (straightHigh) {
    return buildScore(4, straightHigh);
  }
  if (trips.length) {
    return buildScore(3, trips[0], singles[0], singles[1]);
  }
  if (pairs.length >= 2) {
    return buildScore(2, pairs[0], pairs[1], singles[0]);
  }
  if (pairs.length === 1) {
    return buildScore(1, pairs[0], singles[0], singles[1], singles[2]);
  }
  return buildScore(0, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]);
}

function findStraightHigh(present) {
  for (let high = 14; high >= 5; high -= 1) {
    let straight = true;
    for (let value = high; value >= high - 4; value -= 1) {
      if (!present[value]) {
        straight = false;
        break;
      }
    }
    if (straight) {
      return high;
    }
  }
  if (present[14] && present[2] && present[3] && present[4] && present[5]) {
    return 5;
  }
  return 0;
}

function buildScore(category, ...ranks) {
  let score = category << 20;
  let shift = 16;
  for (let i = 0; i < 5; i += 1) {
    const value = i < ranks.length ? ranks[i] : 0;
    score |= value << shift;
    shift -= 4;
  }
  return score;
}
