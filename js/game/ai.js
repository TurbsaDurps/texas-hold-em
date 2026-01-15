import { createDeck, cardKey } from "../core/cards.js";
import { bestScore } from "../core/evaluator.js";
import { clamp } from "../core/utils.js";

export const NPC_CLASSES = [
  "ODDS_DRIVEN",
  "BLUFFER",
  "WELL_ROUNDED",
  "TIGHT_AGGRESSIVE",
  "LOOSE_AGGRESSIVE",
];

export function createNpcProfile(difficulty) {
  let baseSmart;
  let baseBrave;
  let baseBluff;
  let baseDiscipline;
  let baseStack;

  switch (difficulty) {
    case "easy":
      baseSmart = 0.35;
      baseBrave = 0.35;
      baseBluff = 0.25;
      baseDiscipline = 0.35;
      baseStack = 0.35;
      break;
    case "hard":
      baseSmart = 0.78;
      baseBrave = 0.7;
      baseBluff = 0.55;
      baseDiscipline = 0.7;
      baseStack = 0.7;
      break;
    case "normal":
    default:
      baseSmart = 0.55;
      baseBrave = 0.5;
      baseBluff = 0.4;
      baseDiscipline = 0.5;
      baseStack = 0.5;
      break;
  }

  const npcClass = NPC_CLASSES[Math.floor(Math.random() * NPC_CLASSES.length)];
  let profile = {
    npcClass,
    smartness: jitter(baseSmart, 0.18),
    braveness: jitter(baseBrave, 0.2),
    bluffFactor: jitter(baseBluff, 0.25),
    discipline: jitter(baseDiscipline, 0.2),
    stackAwareness: jitter(baseStack, 0.2),
  };

  switch (npcClass) {
    case "ODDS_DRIVEN":
      profile.smartness = clamp(profile.smartness + 0.15, 0.05, 0.98);
      profile.discipline = clamp(profile.discipline + 0.1, 0.05, 0.98);
      profile.bluffFactor = clamp(profile.bluffFactor - 0.05, 0.05, 0.98);
      break;
    case "BLUFFER":
      profile.bluffFactor = clamp(profile.bluffFactor + 0.2, 0.05, 0.98);
      profile.braveness = clamp(profile.braveness + 0.15, 0.05, 0.98);
      profile.discipline = clamp(profile.discipline - 0.1, 0.05, 0.98);
      break;
    case "TIGHT_AGGRESSIVE":
      profile.discipline = clamp(profile.discipline + 0.2, 0.05, 0.98);
      profile.braveness = clamp(profile.braveness + 0.1, 0.05, 0.98);
      break;
    case "LOOSE_AGGRESSIVE":
      profile.braveness = clamp(profile.braveness + 0.2, 0.05, 0.98);
      profile.bluffFactor = clamp(profile.bluffFactor + 0.1, 0.05, 0.98);
      profile.discipline = clamp(profile.discipline - 0.1, 0.05, 0.98);
      break;
    case "WELL_ROUNDED":
      profile = {
        ...profile,
        smartness: clamp(profile.smartness + 0.12, 0.05, 0.98),
        braveness: clamp(profile.braveness + 0.12, 0.05, 0.98),
        bluffFactor: clamp(profile.bluffFactor + 0.1, 0.05, 0.98),
        discipline: clamp(profile.discipline + 0.12, 0.05, 0.98),
        stackAwareness: clamp(profile.stackAwareness + 0.12, 0.05, 0.98),
      };
      break;
    default:
      break;
  }

  return profile;
}

export class NpcBrain {
  decide(npc, state, context) {
    const profile = npc.profile;
    if (!profile) {
      return { action: "call", raiseBy: 0, reason: "default" };
    }

    const equity = estimateEquity(npc, state, profile);
    const adjustedEquity = applyError(equity, profile.smartness);

    const callAmount = Math.max(0, state.currentBet - npc.currentBet);
    const potOdds = callAmount === 0 ? 0 : callAmount / (state.pot + callAmount);

    const stackFactor = evaluateStackPressure(npc, state);
    const aggression = clamp(
      profile.braveness + (1 - stackFactor) * 0.3 * profile.stackAwareness,
      0.1,
      1.2
    );

    let bluffChance = profile.bluffFactor * (1 - adjustedEquity);
    bluffChance *= 0.7 + 0.6 * aggression;
    if (context.raiseCount >= 2) {
      bluffChance *= 0.25;
    }
    if (npc.raisedThisRound) {
      bluffChance *= 0.3;
    }

    const canRaise = context.canRaise;
    let wantsRaise = adjustedEquity > potOdds + 0.12 * profile.discipline;
    if (Math.random() < bluffChance) {
      wantsRaise = true;
    }

    if (npc.raisedThisRound && adjustedEquity < 0.7) {
      wantsRaise = false;
    }

    if (callAmount > 0 && adjustedEquity + 0.1 * aggression < potOdds) {
      if (Math.random() < profile.discipline + 0.2) {
        return { action: "fold", raiseBy: 0, reason: "low equity" };
      }
    }

    if (wantsRaise && canRaise) {
      const raiseBy = chooseRaiseSize(npc, state, profile, context);
      return { action: "raise", raiseBy, reason: "raise" };
    }

    return { action: "call", raiseBy: 0, reason: callAmount > 0 ? "call" : "check" };
  }
}

function chooseRaiseSize(npc, state, profile, context) {
  const callAmount = Math.max(0, state.currentBet - npc.currentBet);
  const maxExtra = Math.max(0, npc.chips - callAmount);
  const base = context.minRaise + Math.floor(Math.random() * context.minRaise);
  const equityBoost = Math.floor(profile.braveness * context.minRaise * 1.5);
  const target = Math.min(base + equityBoost, Math.floor(npc.chips * 0.35));
  const step = Math.max(1, context.smallBlind || context.minRaise);
  const stepped = Math.floor(target / step) * step;
  return clamp(stepped || context.minRaise, context.minRaise, Math.max(context.minRaise, maxExtra));
}

function estimateEquity(npc, state, profile) {
  const simulations = Math.floor(400 + profile.smartness * 500);
  const known = [];
  for (const card of state.communityCards) {
    if (card) known.push(card);
  }
  for (const card of npc.holeCards) {
    if (card) known.push(card);
  }
  if (npc.holeCards.some((card) => !card)) {
    return 0.4;
  }

  let wins = 0;
  let ties = 0;

  for (let t = 0; t < simulations; t += 1) {
    const deck = buildDeckExcluding(known);
    shuffleInPlace(deck);

    const community = [...state.communityCards.filter(Boolean)];
    while (community.length < 5) {
      community.push(deck.pop());
    }

    const opponents = state.players.filter((p) => p !== npc && !p.folded);
    const opponentScores = [];
    for (const opponent of opponents) {
      const oppCards = [deck.pop(), deck.pop()];
      const full = [...oppCards, ...community];
      opponentScores.push(bestScore(full));
    }

    const npcFull = [...npc.holeCards, ...community];
    const npcScore = bestScore(npcFull);

    let npcBest = true;
    let npcTie = false;
    for (const score of opponentScores) {
      if (score > npcScore) {
        npcBest = false;
        npcTie = false;
        break;
      }
      if (score === npcScore) {
        npcTie = true;
      }
    }

    if (npcBest) {
      if (npcTie) {
        ties += 1;
      } else {
        wins += 1;
      }
    }
  }

  const winPct = wins / simulations;
  const tiePct = ties / simulations;
  return winPct + tiePct * 0.5;
}

function applyError(equity, smartness) {
  const range = (1 - smartness) * 0.25;
  const error = (Math.random() * 2 - 1) * range;
  return clamp(equity + error, 0.02, 0.98);
}

function evaluateStackPressure(npc, state) {
  let total = 0;
  let count = 0;
  for (const seat of state.players) {
    if (seat === npc) continue;
    total += Math.max(0, seat.chips);
    count += 1;
  }
  if (count === 0) return 1;
  const average = total / count;
  if (average === 0) return 1;
  return npc.chips / average;
}

function buildDeckExcluding(knownCards) {
  const deck = createDeck();
  if (!knownCards.length) return deck;
  const known = new Set(knownCards.map((card) => cardKey(card)));
  return deck.filter((card) => !known.has(cardKey(card)));
}

function shuffleInPlace(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function jitter(base, range) {
  return clamp(base + (Math.random() * 2 - 1) * range, 0.05, 0.98);
}
