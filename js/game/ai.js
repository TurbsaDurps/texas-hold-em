import { createDeckExcluding, shuffle } from "../core/cards.js";
import { bestScore } from "../core/evaluator.js";
import { clamp } from "../core/utils.js";

export const NPC_CLASSES = [
  "ODDS_DRIVEN",
  "BLUFFER",
  "WELL_ROUNDED",
  "TIGHT_AGGRESSIVE",
  "LOOSE_AGGRESSIVE",
];

const PROFILE_MIN = 0.05;
const PROFILE_MAX = 0.98;

const DIFFICULTY_PROFILES = {
  easy: {
    smartness: 0.35,
    braveness: 0.35,
    bluffFactor: 0.25,
    discipline: 0.35,
    stackAwareness: 0.35,
  },
  normal: {
    smartness: 0.55,
    braveness: 0.5,
    bluffFactor: 0.4,
    discipline: 0.5,
    stackAwareness: 0.5,
  },
  hard: {
    smartness: 0.78,
    braveness: 0.7,
    bluffFactor: 0.55,
    discipline: 0.7,
    stackAwareness: 0.7,
  },
};

export function createNpcProfile(difficulty) {
  const base = DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES.normal;
  const npcClass = NPC_CLASSES[Math.floor(Math.random() * NPC_CLASSES.length)];
  const profile = {
    npcClass,
    smartness: jitter(base.smartness, 0.18),
    braveness: jitter(base.braveness, 0.2),
    bluffFactor: jitter(base.bluffFactor, 0.25),
    discipline: jitter(base.discipline, 0.2),
    stackAwareness: jitter(base.stackAwareness, 0.2),
  };
  applyClassTuning(profile);
  return profile;
}

function applyClassTuning(profile) {
  switch (profile.npcClass) {
    case "ODDS_DRIVEN":
      profile.smartness = clampProfile(profile.smartness + 0.15);
      profile.discipline = clampProfile(profile.discipline + 0.1);
      profile.bluffFactor = clampProfile(profile.bluffFactor - 0.05);
      break;
    case "BLUFFER":
      profile.bluffFactor = clampProfile(profile.bluffFactor + 0.2);
      profile.braveness = clampProfile(profile.braveness + 0.15);
      profile.discipline = clampProfile(profile.discipline - 0.1);
      break;
    case "TIGHT_AGGRESSIVE":
      profile.discipline = clampProfile(profile.discipline + 0.2);
      profile.braveness = clampProfile(profile.braveness + 0.1);
      break;
    case "LOOSE_AGGRESSIVE":
      profile.braveness = clampProfile(profile.braveness + 0.2);
      profile.bluffFactor = clampProfile(profile.bluffFactor + 0.1);
      profile.discipline = clampProfile(profile.discipline - 0.1);
      break;
    case "WELL_ROUNDED":
      profile.smartness = clampProfile(profile.smartness + 0.12);
      profile.braveness = clampProfile(profile.braveness + 0.12);
      profile.bluffFactor = clampProfile(profile.bluffFactor + 0.1);
      profile.discipline = clampProfile(profile.discipline + 0.12);
      profile.stackAwareness = clampProfile(profile.stackAwareness + 0.12);
      break;
    default:
      break;
  }
}

export class NpcBrain {
  decide(npc, state, context) {
    const profile = npc.profile;
    if (!profile) {
      return { action: "call", raiseBy: 0 };
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
        return { action: "fold", raiseBy: 0 };
      }
    }

    if (wantsRaise && canRaise) {
      const raiseBy = chooseRaiseSize(npc, state, profile, context);
      return { action: "raise", raiseBy };
    }

    return { action: "call", raiseBy: 0 };
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
  const known = getKnownCards(state.communityCards, npc.holeCards);
  if (npc.holeCards.some((card) => !card)) {
    return 0.4;
  }

  const baseDeck = createDeckExcluding(known);
  const opponents = state.players.filter((player) => player !== npc && !player.folded);
  let wins = 0;
  let ties = 0;

  for (let t = 0; t < simulations; t += 1) {
    const deck = shuffle([...baseDeck]);
    const community = completeCommunity(state.communityCards, deck);
    const npcScore = bestScore([...npc.holeCards, ...community]);
    const result = compareAgainstOpponents(opponents, community, deck, npcScore);

    if (result === "win") {
      wins += 1;
    } else if (result === "tie") {
      ties += 1;
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

function compareAgainstOpponents(opponents, community, deck, npcScore) {
  let tie = false;
  for (const _opponent of opponents) {
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

function completeCommunity(communityCards, deck) {
  const community = [...communityCards.filter(Boolean)];
  while (community.length < 5) {
    community.push(deck.pop());
  }
  return community;
}

function getKnownCards(communityCards, holeCards) {
  const known = [];
  for (const card of communityCards) {
    if (card) {
      known.push(card);
    }
  }
  for (const card of holeCards) {
    if (card) {
      known.push(card);
    }
  }
  return known;
}

function jitter(base, range) {
  return clampProfile(base + (Math.random() * 2 - 1) * range);
}

function clampProfile(value) {
  return clamp(value, PROFILE_MIN, PROFILE_MAX);
}
