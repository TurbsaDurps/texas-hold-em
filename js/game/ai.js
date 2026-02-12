import { createDeckExcluding, shuffle, cardKey } from "../core/cards.js";
import { bestScore } from "../core/evaluator.js";
import { clamp } from "../core/utils.js";

const STAGE_TRIALS = {
  preflop: 560,
  flop: 760,
  turn: 900,
  river: 700,
};

const STRONG_ARCHETYPES = [
  {
    name: "BALANCED_SOLVER",
    aggression: 0.74,
    discipline: 0.9,
    bluffFrequency: 0.12,
    bluffSelectivity: 0.92,
    trapFrequency: 0.1,
    thinValue: 0.54,
    valueThreshold: 0.62,
    pressureTolerance: 0.83,
    simulationScale: 1.04,
  },
  {
    name: "PRESSURE_EXPERT",
    aggression: 0.8,
    discipline: 0.86,
    bluffFrequency: 0.14,
    bluffSelectivity: 0.9,
    trapFrequency: 0.08,
    thinValue: 0.5,
    valueThreshold: 0.6,
    pressureTolerance: 0.8,
    simulationScale: 1.0,
  },
  {
    name: "GTO_HEAVY",
    aggression: 0.71,
    discipline: 0.92,
    bluffFrequency: 0.1,
    bluffSelectivity: 0.95,
    trapFrequency: 0.12,
    thinValue: 0.57,
    valueThreshold: 0.64,
    pressureTolerance: 0.86,
    simulationScale: 1.08,
  },
];

export function createNpcProfile() {
  const base = STRONG_ARCHETYPES[Math.floor(Math.random() * STRONG_ARCHETYPES.length)];
  return {
    name: base.name,
    aggression: clampProfile(jitter(base.aggression, 0.05)),
    discipline: clampProfile(jitter(base.discipline, 0.04)),
    bluffFrequency: clampProfile(jitter(base.bluffFrequency, 0.03)),
    bluffSelectivity: clampProfile(jitter(base.bluffSelectivity, 0.03)),
    trapFrequency: clampProfile(jitter(base.trapFrequency, 0.03)),
    thinValue: clampProfile(jitter(base.thinValue, 0.04)),
    valueThreshold: clampProfile(jitter(base.valueThreshold, 0.03)),
    pressureTolerance: clampProfile(jitter(base.pressureTolerance, 0.04)),
    simulationScale: clamp(jitter(base.simulationScale, 0.08), 0.86, 1.18),
  };
}

export class NpcBrain {
  constructor() {
    this.equityCache = new Map();
  }

  decide(npc, state, context) {
    if (npc.holeCards.some((card) => !card)) {
      return { action: "call", raiseBy: 0 };
    }

    const profile = npc.profile || createNpcProfile();
    const opponents = state.players.filter((player) => player !== npc && !player.folded);
    const callAmount = Math.max(0, state.currentBet - npc.currentBet);
    const potAfterCall = state.pot + callAmount;
    const potOdds = callAmount === 0 ? 0 : callAmount / Math.max(1, potAfterCall);
    const stage = resolveStage(state.communityCards);
    const community = state.communityCards.filter(Boolean);
    const board = analyzeBoardTexture(community);
    const reads = readOpponents(opponents, state.currentBet);
    const canRaise = Boolean(context?.canRaise);
    const drawStrength = estimateDrawStrength(npc.holeCards, community, stage);
    const blockerStrength = estimateBlockerStrength(npc.holeCards, community, board);
    const madeStrength = estimateMadeStrength(npc.holeCards, community);
    const stackFactor = evaluateStackPressure(npc, state);
    const effectiveStack = getEffectiveStack(npc, opponents);
    const spr = effectiveStack / Math.max(1, potAfterCall);
    const equity = this.estimateEquity(npc, state, opponents, stage, profile.simulationScale);

    const multiwayPenalty = Math.max(0, opponents.length - 1) * 0.032;
    const pressurePenalty =
      reads.pressure * (1.06 - profile.pressureTolerance) * 0.17 + reads.aggression * 0.03;
    const drawRelief = drawStrength * 0.075;
    const shortStackUrgency = stackFactor < 0.65 ? (0.65 - stackFactor) * 0.085 : 0;
    const requiredCallEquity = clamp(
      potOdds + pressurePenalty + multiwayPenalty - drawRelief - shortStackUrgency,
      0.05,
      0.9
    );

    if (callAmount > 0 && npc.chips <= callAmount) {
      const jamCallThreshold = Math.max(0.36, requiredCallEquity - 0.02);
      if (equity >= jamCallThreshold || drawStrength >= 0.74) {
        return { action: "allin", raiseBy: 0 };
      }
      return { action: "fold", raiseBy: 0 };
    }

    const callRisk = callAmount / Math.max(1, npc.chips);
    const foldThreshold = requiredCallEquity + 0.02 + callRisk * 0.1 + board.wetness * 0.04;
    if (
      callAmount > 0 &&
      equity + blockerStrength * 0.04 < foldThreshold &&
      drawStrength < 0.55 &&
      madeStrength < 0.64
    ) {
      return { action: "fold", raiseBy: 0 };
    }
    if (callAmount > 0 && callRisk > 0.48 && equity < requiredCallEquity + 0.03 && madeStrength < 0.6) {
      return { action: "fold", raiseBy: 0 };
    }

    if (canRaise) {
      const jamThreshold = clamp(
        0.86 -
          profile.aggression * 0.06 -
          (spr < 2.2 ? 0.1 : spr < 3.6 ? 0.04 : 0) +
          reads.pressure * 0.04,
        0.64,
        0.9
      );

      const jamForValue = equity >= jamThreshold && (madeStrength > 0.7 || spr < 2.4);
      const jamForDraw = drawStrength > 0.82 && spr < 2.1 && reads.foldLikelihood > 0.28;
      if (jamForValue || jamForDraw) {
        return { action: "allin", raiseBy: 0 };
      }

      const reraisedPot = callAmount > (context.minRaise || 1) * 2;
      const valueThreshold = clamp(
        profile.valueThreshold +
          pressurePenalty * 0.5 +
          multiwayPenalty * 0.7 +
          (reraisedPot ? 0.06 : 0) -
          blockerStrength * 0.03 -
          (callAmount === 0 ? 0.05 : 0),
        0.5,
        0.92
      );

      const shouldTrap =
        callAmount > 0 &&
        madeStrength > 0.88 &&
        drawStrength < 0.25 &&
        Math.random() < profile.trapFrequency;

      if (!shouldTrap && (equity >= valueThreshold || (madeStrength > 0.8 && equity > valueThreshold - 0.05))) {
        const raiseBy = chooseRaiseSize({
          mode: "value",
          npc,
          state,
          context,
          stage,
          equity,
          board,
          reads,
          effectiveStack,
          profile,
        });
        if (raiseBy > 0) {
          return { action: "raise", raiseBy };
        }
      }

      const bluffWindow = equity > 0.24 && equity < 0.56;
      const bluffQuality =
        drawStrength * 0.42 +
        blockerStrength * 0.36 +
        reads.foldLikelihood * 0.33 +
        board.scare * 0.24 -
        reads.pressure * 0.45 -
        multiwayPenalty * 0.55;
      const stageBluffRate = getStageBluffRate(stage);
      const bluffChance = clamp(
        stageBluffRate * profile.bluffFrequency +
          (bluffQuality - 0.46) * 0.34 -
          callRisk * 0.15 -
          (npc.raisedThisRound ? 0.08 : 0),
        0,
        0.28
      );
      const qualityBluffSpot =
        bluffWindow &&
        bluffQuality > 0.52 &&
        callAmount <= Math.max(state.pot * 0.9, (context.minRaise || 1) * 3);

      if (qualityBluffSpot && Math.random() < bluffChance * profile.bluffSelectivity) {
        const raiseBy = chooseRaiseSize({
          mode: "bluff",
          npc,
          state,
          context,
          stage,
          equity,
          board,
          reads,
          effectiveStack,
          profile,
        });
        if (raiseBy > 0) {
          return { action: "raise", raiseBy };
        }
      }

      const probeScore =
        equity * 0.64 +
        reads.foldLikelihood * 0.23 +
        blockerStrength * 0.13 -
        reads.pressure * 0.14;
      const protectionSpot = board.wetness > 0.52 && madeStrength > 0.46;
      if (
        callAmount === 0 &&
        (probeScore > profile.thinValue || (stage === "flop" && protectionSpot && probeScore > 0.5))
      ) {
        const raiseBy = chooseRaiseSize({
          mode: "probe",
          npc,
          state,
          context,
          stage,
          equity,
          board,
          reads,
          effectiveStack,
          profile,
        });
        if (raiseBy > 0) {
          return { action: "raise", raiseBy };
        }
      }
    }

    return { action: "call", raiseBy: 0 };
  }

  estimateEquity(npc, state, opponents, stage, simulationScale) {
    const cacheKey = buildEquityCacheKey(npc, state, opponents.length);
    const cached = this.equityCache.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const baseTrials = STAGE_TRIALS[stage] || STAGE_TRIALS.flop;
    const trials = Math.max(
      260,
      Math.floor(baseTrials * simulationScale * (0.92 + opponents.length * 0.08))
    );
    const known = getKnownCards(state.communityCards, npc.holeCards);
    const baseDeck = createDeckExcluding(known);
    let wins = 0;
    let ties = 0;

    for (let t = 0; t < trials; t += 1) {
      const deck = shuffle([...baseDeck]);
      const community = completeCommunity(state.communityCards, deck);
      const npcScore = bestScore([...npc.holeCards, ...community]);
      const result = compareAgainstOpponents(opponents.length, community, deck, npcScore);
      if (result === "win") {
        wins += 1;
      } else if (result === "tie") {
        ties += 1;
      }
    }

    const equity = (wins + ties * 0.5) / trials;
    this.setCachedEquity(cacheKey, equity);
    return equity;
  }

  setCachedEquity(key, value) {
    if (this.equityCache.size >= 220) {
      const oldestKey = this.equityCache.keys().next().value;
      if (oldestKey != null) {
        this.equityCache.delete(oldestKey);
      }
    }
    this.equityCache.set(key, value);
  }
}

function buildEquityCacheKey(npc, state, opponentCount) {
  const holeKey = npc.holeCards.filter(Boolean).map(cardKey).join(".");
  const communityKey = state.communityCards.filter(Boolean).map(cardKey).join(".");
  return `${holeKey}|${communityKey}|${opponentCount}`;
}

function chooseRaiseSize({
  mode,
  npc,
  state,
  context,
  stage,
  equity,
  board,
  reads,
  effectiveStack,
  profile,
}) {
  const callAmount = Math.max(0, state.currentBet - npc.currentBet);
  const minRaise = Math.max(1, Math.floor(context?.minRaise || 1));
  const maxRaiseBy = Math.max(0, npc.chips - callAmount);
  if (maxRaiseBy < minRaise) {
    return 0;
  }

  const potAfterCall = state.pot + callAmount;
  const spr = effectiveStack / Math.max(1, potAfterCall);
  const step = Math.max(1, Math.floor(context?.smallBlind || minRaise));
  let factor;

  if (mode === "value") {
    factor = getValueRaiseFactor(stage, board.wetness, reads.pressure, profile.aggression, spr);
  } else if (mode === "bluff") {
    factor = getBluffRaiseFactor(stage, board, reads, spr);
  } else {
    factor = getProbeRaiseFactor(stage, board, reads);
  }

  let rawRaiseBy = potAfterCall * factor + minRaise * 0.3;
  if (mode === "value" && equity > 0.88) {
    rawRaiseBy = rawRaiseBy * 1.25 + minRaise * 0.5;
  }
  if (mode === "bluff" && stage === "river") {
    rawRaiseBy = Math.max(rawRaiseBy, potAfterCall * 0.84);
  }

  const stackCapRatio = mode === "bluff" ? 0.76 : 0.95;
  rawRaiseBy = Math.min(rawRaiseBy, maxRaiseBy * stackCapRatio);
  if (rawRaiseBy < minRaise) {
    rawRaiseBy = minRaise;
  }

  const stepped = Math.floor(rawRaiseBy / step) * step;
  return clamp(stepped || minRaise, minRaise, maxRaiseBy);
}

function getValueRaiseFactor(stage, wetness, pressure, aggression, spr) {
  const baseByStage = {
    preflop: 0.72,
    flop: 0.78,
    turn: 0.9,
    river: 1.02,
  };
  const base = baseByStage[stage] || 0.8;
  const sprBoost = spr < 3 ? 0.14 : spr < 5 ? 0.06 : 0;
  return base + wetness * 0.22 + pressure * 0.12 + aggression * 0.14 + sprBoost;
}

function getBluffRaiseFactor(stage, board, reads, spr) {
  const baseByStage = {
    preflop: 0.55,
    flop: 0.52,
    turn: 0.66,
    river: 0.86,
  };
  const base = baseByStage[stage] || 0.6;
  const sprBoost = spr > 6 ? 0.05 : 0;
  return base + board.scare * 0.22 + reads.foldLikelihood * 0.18 - reads.pressure * 0.07 + sprBoost;
}

function getProbeRaiseFactor(stage, board, reads) {
  const baseByStage = {
    preflop: 0.42,
    flop: 0.46,
    turn: 0.56,
    river: 0.72,
  };
  const base = baseByStage[stage] || 0.5;
  return base + board.wetness * 0.16 + reads.foldLikelihood * 0.12;
}

function resolveStage(communityCards) {
  const count = communityCards.filter(Boolean).length;
  if (count === 0) return "preflop";
  if (count === 3) return "flop";
  if (count === 4) return "turn";
  return "river";
}

function getStageBluffRate(stage) {
  if (stage === "preflop") return 0.34;
  if (stage === "flop") return 1;
  if (stage === "turn") return 0.88;
  return 0.64;
}

function analyzeBoardTexture(community) {
  if (community.length < 3) {
    return { wetness: 0.08, scare: 0.08, paired: false };
  }
  const suitCounts = getSuitCounts(community);
  const rankCounts = getRankCounts(community);
  const ranks = community.map((card) => card.rank);
  const maxSuitCount = Math.max(...suitCounts.values());
  const flushPressure = maxSuitCount >= 3 ? clamp((maxSuitCount - 2) / 3, 0, 1) : 0;
  const straightPressure = clamp((longestStraightRun(ranks) - 2) / 3, 0, 1);
  const paired = [...rankCounts.values()].some((count) => count >= 2);
  const highCards = ranks.filter((rank) => rank >= 11).length;
  const scare = clamp(
    highCards / Math.max(3, community.length) * 0.44 +
      flushPressure * 0.3 +
      straightPressure * 0.18 +
      (paired ? 0.08 : 0),
    0,
    1
  );
  const wetness = clamp(flushPressure * 0.45 + straightPressure * 0.4 + (paired ? 0.12 : 0), 0, 1);
  return { wetness, scare, paired };
}

function readOpponents(opponents, currentBet) {
  if (!opponents.length) {
    return { pressure: 0.05, aggression: 0.05, foldLikelihood: 0.72 };
  }

  let pressureTotal = 0;
  let aggressionCount = 0;
  let foldLikelihoodPool = 0;
  let foldLikelihoodCount = 0;

  for (const opponent of opponents) {
    const action = (opponent.lastAction || "").toLowerCase();
    let lineStrength = 0.34;

    if (action.includes("raises")) lineStrength += 0.43;
    if (action.includes("all in")) lineStrength += 0.5;
    if (action.includes("calls all in")) lineStrength += 0.35;
    if (action.includes("calls")) lineStrength += 0.16;
    if (action.includes("checks")) lineStrength -= 0.08;
    if (opponent.raisedThisRound) lineStrength += 0.24;
    if (opponent.allIn) lineStrength += 0.22;
    if (currentBet > 0 && opponent.currentBet === currentBet) lineStrength += 0.11;

    const normalizedLine = clamp(lineStrength, 0.02, 1);
    pressureTotal += normalizedLine;
    if (normalizedLine > 0.75) {
      aggressionCount += 1;
    }

    if (!opponent.allIn) {
      const commitment = currentBet > 0 ? opponent.currentBet / currentBet : 0;
      const foldLikelihood = clamp(
        0.78 - normalizedLine - commitment * 0.22 - Math.min(0.18, commitment * commitment * 0.2),
        0.03,
        0.92
      );
      foldLikelihoodPool += foldLikelihood;
      foldLikelihoodCount += 1;
    }
  }

  const pressure = pressureTotal / opponents.length;
  const aggression = aggressionCount / opponents.length;
  const foldLikelihood =
    foldLikelihoodCount === 0
      ? 0.06
      : clamp(
          foldLikelihoodPool / foldLikelihoodCount - Math.max(0, opponents.length - 1) * 0.07,
          0.04,
          0.82
        );

  return { pressure, aggression, foldLikelihood };
}

function estimateMadeStrength(holeCards, community) {
  if (community.length === 0) {
    return estimatePreflopStrength(holeCards[0], holeCards[1]);
  }
  const score = bestScore([...holeCards, ...community]);
  const category = score >> 20;
  const categoryStrength = [0.08, 0.24, 0.38, 0.52, 0.65, 0.77, 0.87, 0.95, 0.99];
  const highRankNibble = (score >> 16) & 0xf;
  const kickerBoost = clamp((highRankNibble - 2) / 12, 0, 1) * 0.06;
  return clamp((categoryStrength[category] || 0.05) + kickerBoost, 0, 1);
}

function estimatePreflopStrength(cardA, cardB) {
  if (!cardA || !cardB) return 0.2;
  const high = Math.max(cardA.rank, cardB.rank);
  const low = Math.min(cardA.rank, cardB.rank);
  const pair = cardA.rank === cardB.rank;
  const suited = cardA.suit === cardB.suit;
  const gap = Math.abs(cardA.rank - cardB.rank);

  let score = (high - 2) / 12 * 0.36 + (low - 2) / 12 * 0.15;
  if (pair) score += 0.3 + high / 14 * 0.2;
  if (suited) score += 0.07;
  if (gap <= 1) score += 0.08;
  else if (gap === 2) score += 0.04;
  if (high >= 13) score += 0.06;
  if (high === 14 && low >= 10) score += 0.07;

  return clamp(score, 0.05, 0.98);
}

function estimateDrawStrength(holeCards, community, stage) {
  if (community.length < 3 || stage === "river") {
    return 0;
  }

  const cards = [...holeCards, ...community];
  const suitCounts = getSuitCounts(cards);
  const holeSuits = new Set(holeCards.map((card) => card.suit));
  let flushDraw = 0;
  for (const [suit, count] of suitCounts.entries()) {
    if (!holeSuits.has(suit)) continue;
    if (count >= 5) flushDraw = Math.max(flushDraw, 1);
    else if (count === 4) flushDraw = Math.max(flushDraw, 0.78);
    else if (count === 3 && stage === "flop") flushDraw = Math.max(flushDraw, 0.34);
  }

  const straightDraw = estimateStraightDraw(holeCards, community, stage);
  const comboBonus = flushDraw >= 0.7 && straightDraw >= 0.5 ? 0.12 : 0;
  return clamp(flushDraw * 0.58 + straightDraw * 0.42 + comboBonus, 0, 1);
}

function estimateStraightDraw(holeCards, community, stage) {
  if (community.length < 3) return 0;

  const ranks = new Set([...holeCards, ...community].map((card) => card.rank));
  if (ranks.has(14)) ranks.add(1);
  const holeRanks = new Set(holeCards.map((card) => card.rank));
  if (holeRanks.has(14)) holeRanks.add(1);

  let best = 0;
  for (let high = 14; high >= 5; high -= 1) {
    let hits = 0;
    let holeHits = 0;
    for (let rank = high; rank >= high - 4; rank -= 1) {
      if (ranks.has(rank)) {
        hits += 1;
      }
      if (holeRanks.has(rank)) {
        holeHits += 1;
      }
    }
    if (holeHits === 0) continue;
    if (hits === 5) {
      best = Math.max(best, 1);
    } else if (hits === 4) {
      best = Math.max(best, 0.64);
    } else if (hits === 3 && stage === "flop") {
      best = Math.max(best, 0.28);
    }
  }
  return best;
}

function estimateBlockerStrength(holeCards, community, board) {
  if (!community.length) return 0;

  const boardSuits = getSuitCounts(community);
  const maxSuitCount = Math.max(...boardSuits.values());
  const dominantSuitEntry = [...boardSuits.entries()].sort((a, b) => b[1] - a[1])[0];
  const dominantSuit = dominantSuitEntry ? dominantSuitEntry[0] : null;
  const boardRanks = [...new Set(community.map((card) => card.rank))].sort((a, b) => b - a);
  const topBoardRank = boardRanks[0] || 14;
  const rankCounts = getRankCounts(community);
  const pairedRanks = [...rankCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([rank]) => rank);

  let blocker = 0;
  for (const card of holeCards) {
    if (maxSuitCount >= 3 && card.suit === dominantSuit) {
      blocker += card.rank >= 11 ? 0.19 : 0.1;
      if (card.rank === 14) blocker += 0.14;
    }
    if (card.rank >= topBoardRank) {
      blocker += 0.12;
    }
    if (pairedRanks.includes(card.rank)) {
      blocker += 0.14;
    }
  }

  blocker += board.scare * 0.06;
  return clamp(blocker, 0, 1);
}

function evaluateStackPressure(npc, state) {
  let total = 0;
  let count = 0;
  for (const player of state.players) {
    if (player === npc) continue;
    total += Math.max(0, player.chips);
    count += 1;
  }
  if (count === 0) return 1;
  const average = total / count;
  if (average <= 0) return 1;
  return npc.chips / average;
}

function getEffectiveStack(npc, opponents) {
  let smallestOpponentStack = Infinity;
  for (const opponent of opponents) {
    if (opponent.allIn) continue;
    smallestOpponentStack = Math.min(smallestOpponentStack, opponent.chips);
  }
  if (smallestOpponentStack === Infinity) {
    return npc.chips;
  }
  return Math.min(npc.chips, smallestOpponentStack);
}

function completeCommunity(communityCards, deck) {
  const community = [...communityCards.filter(Boolean)];
  while (community.length < 5) {
    community.push(deck.pop());
  }
  return community;
}

function compareAgainstOpponents(opponentCount, community, deck, npcScore) {
  let tie = false;
  for (let i = 0; i < opponentCount; i += 1) {
    const opponentScore = bestScore([deck.pop(), deck.pop(), ...community]);
    if (opponentScore > npcScore) {
      return "loss";
    }
    if (opponentScore === npcScore) {
      tie = true;
    }
  }
  return tie ? "tie" : "win";
}

function getKnownCards(communityCards, holeCards) {
  const known = [];
  for (const card of communityCards) {
    if (card) known.push(card);
  }
  for (const card of holeCards) {
    if (card) known.push(card);
  }
  return known;
}

function getRankCounts(cards) {
  const counts = new Map();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  }
  return counts;
}

function getSuitCounts(cards) {
  const counts = new Map();
  for (const card of cards) {
    counts.set(card.suit, (counts.get(card.suit) || 0) + 1);
  }
  return counts;
}

function longestStraightRun(ranksInput) {
  const ranks = new Set(ranksInput);
  if (ranks.has(14)) ranks.add(1);
  const sorted = [...ranks].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run += 1;
      best = Math.max(best, run);
    } else if (sorted[i] !== sorted[i - 1]) {
      run = 1;
    }
  }
  return clamp(best, 1, 5);
}

function jitter(value, range) {
  return value + (Math.random() * 2 - 1) * range;
}

function clampProfile(value) {
  return clamp(value, 0.05, 0.98);
}
