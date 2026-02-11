import { createDeck, shuffle } from "../core/cards.js";

function emptyCommunityCards() {
  return Array(5).fill(null);
}

export class GameState {
  constructor(config, npcProfileFactory) {
    this.config = config;
    this.npcProfileFactory = npcProfileFactory;
    this.players = [];
    this.communityCards = emptyCommunityCards();
    this.burnPile = [];
    this.deck = [];
    this.dealerIndex = 0;
    this.pot = 0;
    this.currentBet = 0;
    this.stage = "preflop";
    this.handCount = 0;
  }

  setupPlayers() {
    const players = [buildPlayer("You", this.config.startingChips, true)];
    for (let i = 0; i < this.config.npcCount; i += 1) {
      const npc = buildPlayer(`NPC ${i + 1}`, this.config.startingChips, false);
      npc.profile = this.npcProfileFactory();
      players.push(npc);
    }
    this.players = players;
    this.dealerIndex = 0;
    this.handCount = 0;
  }

  resetForNewHand(advanceDealer) {
    if (!this.players.length) return [];
    if (advanceDealer) {
      this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    }
    this.deck = shuffle(createDeck());
    for (const player of this.players) {
      resetPlayerForHand(player);
    }
    this.communityCards = emptyCommunityCards();
    this.burnPile = [];
    this.pot = 0;
    this.currentBet = 0;
    this.stage = "preflop";
    this.handCount += 1;

    if (this.config.allowRebuys) {
      return this.rebuyNpcIfNeeded();
    }
    return [];
  }

  postBlind(playerIndex, amount) {
    const player = this.players[playerIndex];
    const posted = takeChips(player, amount);
    player.currentBet += posted;
    this.pot += posted;
    this.currentBet = Math.max(this.currentBet, player.currentBet);
  }

  clearBets() {
    this.currentBet = 0;
    for (const player of this.players) {
      player.currentBet = 0;
      player.actedThisRound = false;
      player.raisedThisRound = false;
    }
  }

  activePlayers() {
    return this.players.filter((player) => !player.folded);
  }

  actingPlayers() {
    return this.players.filter((player) => !player.folded && !player.allIn);
  }

  rebuyNpcIfNeeded() {
    const announcements = [];
    const average = this.averageStack();
    for (const player of this.players) {
      if (player.isHuman || player.chips > 0) continue;
      const base = Math.max(average, this.config.bigBlind * 40);
      const variation = Math.floor(base * 0.2);
      const amount = base + Math.floor(Math.random() * (variation * 2 + 1)) - variation;
      const minBuyIn = Math.max(this.config.bigBlind * 20, 10);
      const minRounded = Math.ceil(minBuyIn / 10) * 10;
      const rounded = Math.round(amount / 10) * 10;
      player.chips = Math.max(rounded, minRounded);
      announcements.push({ name: player.name, amount: player.chips });
    }
    return announcements;
  }

  averageStack() {
    let total = 0;
    let count = 0;
    for (const player of this.players) {
      if (player.chips > 0) {
        total += player.chips;
        count += 1;
      }
    }
    return count === 0 ? 0 : Math.floor(total / count);
  }
}

export function buildPlayer(name, chips, isHuman) {
  return {
    name,
    chips,
    isHuman,
    holeCards: [null, null],
    currentBet: 0,
    folded: false,
    allIn: false,
    actedThisRound: false,
    raisedThisRound: false,
    profile: null,
    lastAction: "",
  };
}

export function resetPlayerForHand(player) {
  player.holeCards = [null, null];
  player.currentBet = 0;
  player.folded = false;
  player.allIn = false;
  player.actedThisRound = false;
  player.raisedThisRound = false;
  player.lastAction = "";
}

export function takeChips(player, amount) {
  const actual = Math.min(amount, player.chips);
  player.chips -= actual;
  if (player.chips === 0) {
    player.allIn = true;
  }
  return actual;
}
