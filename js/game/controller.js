import { sleep, clamp, formatChips } from "../core/utils.js";
import { bestScore } from "../core/evaluator.js";
import { takeChips } from "./state.js";
import { estimateAllInOdds } from "./odds.js";

const STAGE_ORDER = ["preflop", "flop", "turn", "river"];

export class GameController {
  constructor(state, ui, config, npcBrain) {
    this.state = state;
    this.ui = ui;
    this.config = config;
    this.npcBrain = npcBrain;

    this.pendingActionResolver = null;
    this.handInProgress = false;
    this.raiseCount = 0;
    this.autoStartTimer = null;
    this.allInOddsShown = false;
    this.seatOrder = this.buildSeatOrder();
  }

  async startHand() {
    if (this.handInProgress) return;
    this.handInProgress = true;

    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
    }

    try {
      const rebuys = this.state.resetForNewHand(true);
      this.ui.resetTable();
      this.allInOddsShown = false;
      this.ui.setDealerSeat(this.getDealerSeat());
      this.postBlinds();
      this.ui.updateNpcLabels(this.state.players);
      this.ui.updatePot(this.state.pot, `Blinds ${this.smallBlind}/${this.bigBlind}`);

      if (rebuys.length) {
        const message = rebuys
          .map((entry) => `${entry.name} buys in for ${formatChips(entry.amount)}`)
          .join(" • ");
        this.ui.showAnnouncement(message, this.config.announcementDurationMs || 2500);
      }

      await sleep(this.config.preDealDelayMs);
      await this.dealHoleCards();
      await this.runBettingRound(this.getPreFlopStart());
    } finally {
      this.pendingActionResolver = null;
      this.updateButtonState();
      this.handInProgress = false;
    }

    if (this.config.autoStartHands) {
      this.autoStartTimer = setTimeout(
        () => this.startHand(),
        this.config.handTransitionDelayMs
      );
    }
  }

  queuePlayerAction(actionPayload) {
    if (!this.pendingActionResolver) return;
    const resolve = this.pendingActionResolver;
    this.pendingActionResolver = null;
    const action =
      typeof actionPayload === "string"
        ? { action: actionPayload }
        : actionPayload || { action: "call" };
    resolve(action);
    this.updateButtonState();
  }

  updateButtonState() {
    const player = this.state.players[0];
    if (!player) {
      this.ui.setButtonsEnabled({
        canFold: false,
        canCall: false,
        canRaise: false,
        canAllIn: false,
        callLabel: "CALL",
        raiseLabel: "※RAISE",
      });
      this.ui.setRaiseRange(0, 0, 0, this.config.smallBlind);
      return;
    }

    const callAmount = Math.max(0, this.state.currentBet - player.currentBet);
    const isPlayerTurn = this.pendingActionResolver != null;
    const canRaise = isPlayerTurn && this.canRaise(player);
    const canAllIn = isPlayerTurn && player.chips > 0;

    this.ui.setButtonsEnabled({
      canFold: isPlayerTurn,
      canCall: isPlayerTurn,
      canRaise,
      canAllIn,
      callLabel: callAmount > 0 ? `CALL ${callAmount}` : "CHECK",
      raiseLabel: callAmount > 0 ? "※RAISE" : "※BET",
    });

    if (canRaise) {
      const minRaise = this.getMinRaise();
      const maxRaise = Math.max(minRaise, player.chips - callAmount);
      this.ui.setRaiseRange(minRaise, maxRaise, minRaise, this.config.smallBlind);
    } else {
      this.ui.setRaiseRange(0, 0, 0, this.config.smallBlind);
    }
  }

  getMinRaise() {
    return Math.max(this.bigBlind || this.config.bigBlind || 1, 1);
  }

  async dealHoleCards() {
    const order = this.getDealOrder();
    for (let round = 0; round < 2; round += 1) {
      for (const seat of order) {
        const player = this.state.players[seat];
        player.holeCards[round] = this.state.deck.pop();
      }
    }
    await this.ui.dealHoleCards(order, this.state.players, this.config.dealDelayMs);
  }

  async dealFlop() {
    await this.dealStreet([0, 1, 2]);
  }

  async dealTurn() {
    await this.dealStreet([3]);
  }

  async dealRiver() {
    await this.dealStreet([4]);
  }

  async dealStreet(indices) {
    this.state.burnPile.push(this.state.deck.pop());
    this.ui.updateBurnPile(this.state.burnPile.length);
    const cards = [];
    for (const index of indices) {
      const card = this.state.deck.pop();
      this.state.communityCards[index] = card;
      cards.push({ index, card });
    }
    await this.ui.dealCommunity(cards, this.config.dealDelayMs, () => this.updateAllInOdds());
  }

  async runBettingRound(startIndex) {
    this.beginRound();

    if (await this.resolveHandByFold()) {
      return;
    }
    if (this.shouldRunOutBoard()) {
      await this.runOutToShowdown();
      return;
    }

    let currentIndex = this.findNextActingIndex(startIndex);
    if (currentIndex == null) {
      await this.runOutToShowdown();
      return;
    }

    while (!this.isBettingRoundSettled()) {
      if (await this.resolveHandByFold()) {
        return;
      }

      const player = this.state.players[currentIndex];
      if (!this.canPlayerAct(player)) {
        currentIndex = this.findNextActingIndex(this.nextPlayerIndex(currentIndex));
        if (currentIndex == null) break;
        continue;
      }

      const action = await this.getPlayerAction(player);
      const result = this.applyAction(player, action);
      if (result.raised) {
        this.markOtherPlayersUnacted(this.state.players.indexOf(player));
      }

      this.ui.updateNpcLabels(this.state.players);
      this.ui.updatePot(this.state.pot, `${player.name} ${player.lastAction || "acts"}`);

      if (result.isNpc) {
        await sleep(this.config.npcThinkDelayMs);
      }

      if (await this.resolveHandByFold()) {
        return;
      }
      if (this.shouldRunOutBoard()) {
        await this.runOutToShowdown();
        return;
      }

      currentIndex = this.findNextActingIndex(this.nextPlayerIndex(currentIndex));
      if (currentIndex == null) break;
    }

    if (await this.resolveHandByFold()) {
      return;
    }
    if (this.state.stage === "river") {
      await this.resolveShowdown();
      return;
    }

    this.state.clearBets();
    this.ui.clearBetIndicators();
    this.state.stage = this.getNextStage(this.state.stage);
    await this.dealCurrentStage();
    await this.runBettingRound(this.getPostFlopStart());
  }

  beginRound() {
    this.raiseCount = 0;
    for (const player of this.state.players) {
      player.actedThisRound = false;
      player.raisedThisRound = false;
    }
  }

  canPlayerAct(player) {
    return Boolean(player && !player.folded && !player.allIn);
  }

  findNextActingIndex(startIndex) {
    if (!this.state.players.length) return null;
    let index = startIndex;
    for (let i = 0; i < this.state.players.length; i += 1) {
      const player = this.state.players[index];
      if (this.canPlayerAct(player)) {
        return index;
      }
      index = this.nextPlayerIndex(index);
    }
    return null;
  }

  isBettingRoundSettled() {
    const acting = this.state.actingPlayers();
    if (!acting.length) return true;
    for (const player of acting) {
      if (!player.actedThisRound) return false;
      if (player.currentBet !== this.state.currentBet) return false;
    }
    return true;
  }

  async getPlayerAction(player) {
    if (player.isHuman) {
      return this.waitForPlayerAction();
    }
    return this.npcBrain.decide(player, this.state, {
      minRaise: this.getMinRaise(),
      smallBlind: this.config.smallBlind,
      canRaise: this.canRaise(player),
      raiseCount: this.raiseCount,
    });
  }

  applyAction(player, actionPayload) {
    const seat = this.state.players.indexOf(player);
    const callAmount = Math.max(0, this.state.currentBet - player.currentBet);
    const preActionBet = this.state.currentBet;
    const action = actionPayload || { action: "call" };
    let raised = false;

    switch (action.action) {
      case "fold":
        player.folded = true;
        player.lastAction = "folds";
        if (seat >= 0) {
          this.ui.setFoldedSeat(seat, true);
          this.ui.setBetAmount(seat, 0);
        }
        break;
      case "allin": {
        if (player.chips <= 0) {
          return this.applyAction(player, { action: "call" });
        }
        const contributed = this.commitChips(player, player.chips);
        raised = player.currentBet > preActionBet;
        if (raised) {
          this.raiseCount += 1;
          player.raisedThisRound = true;
          player.lastAction = "all in";
        } else if (callAmount > 0 && contributed < callAmount) {
          player.lastAction = "calls all in";
        } else if (callAmount > 0) {
          player.lastAction = "calls";
        } else {
          player.lastAction = "all in";
        }
        if (seat >= 0) {
          this.ui.setBetAmount(seat, player.currentBet);
        }
        break;
      }
      case "raise": {
        if (!this.canRaise(player)) {
          return this.applyAction(player, { action: "call" });
        }
        const minRaise = this.getMinRaise();
        const maxRaiseBy = Math.max(0, player.chips - callAmount);
        if (maxRaiseBy < minRaise) {
          return this.applyAction(player, { action: "call" });
        }

        const raiseBy = clamp(action.raiseBy || minRaise, minRaise, maxRaiseBy);
        const targetBet = this.state.currentBet + raiseBy;
        const needed = Math.max(0, targetBet - player.currentBet);
        this.commitChips(player, needed);
        raised = player.currentBet > preActionBet;

        if (!raised) {
          return this.applyAction(player, { action: "call" });
        }

        this.raiseCount += 1;
        player.raisedThisRound = true;
        player.lastAction = player.allIn ? "all in" : `raises ${player.currentBet}`;
        if (seat >= 0) {
          this.ui.setBetAmount(seat, player.currentBet);
        }
        break;
      }
      case "call":
      default: {
        const contributed = this.commitChips(player, callAmount);
        if (callAmount > 0 && contributed < callAmount) {
          player.lastAction = "calls all in";
        } else {
          player.lastAction = callAmount > 0 ? "calls" : "checks";
        }
        if (seat >= 0 && player.currentBet > 0) {
          this.ui.setBetAmount(seat, player.currentBet);
        } else if (seat >= 0 && callAmount === 0) {
          this.ui.setBetAmount(seat, 0);
        }
        break;
      }
    }

    player.actedThisRound = true;
    if (player.chips === 0) {
      player.allIn = true;
    }

    return { raised, isNpc: !player.isHuman };
  }

  commitChips(player, amount) {
    const contribution = takeChips(player, Math.max(0, amount));
    if (contribution <= 0) return 0;
    player.currentBet += contribution;
    player.totalContribution += contribution;
    this.state.pot += contribution;
    this.state.currentBet = Math.max(this.state.currentBet, player.currentBet);
    return contribution;
  }

  markOtherPlayersUnacted(actingSeat) {
    for (let seat = 0; seat < this.state.players.length; seat += 1) {
      if (seat === actingSeat) continue;
      const player = this.state.players[seat];
      if (!this.canPlayerAct(player)) continue;
      player.actedThisRound = false;
    }
  }

  async resolveHandByFold() {
    if (this.state.activePlayers().length > 1) return false;
    this.awardPotByFold();
    return true;
  }

  shouldRunOutBoard() {
    const activeCount = this.state.activePlayers().length;
    if (activeCount <= 1 || !this.hasAnyAllIn()) {
      return false;
    }

    const sidePotActors = this.getSidePotActors();
    if (sidePotActors.length >= 2) {
      return false;
    }
    if (!sidePotActors.length) {
      return true;
    }

    const lastActor = sidePotActors[0];
    return lastActor.actedThisRound && lastActor.currentBet === this.state.currentBet;
  }

  getSidePotActors() {
    return this.state.activePlayers().filter((player) => !player.allIn);
  }

  async runOutToShowdown() {
    this.refundUncalledAllInExcess();
    this.showAllInOdds();
    await this.runOutRemaining();
  }

  showAllInOdds() {
    if (this.allInOddsShown) return;
    if (!this.hasAnyAllIn()) return;

    const activeEntries = this.getActiveEntries();
    if (activeEntries.length <= 1) return;

    this.applyAllInOdds(activeEntries);
    this.ui.revealNpcCards(
      this.state.players,
      activeEntries.map((entry) => entry.seat)
    );
    this.allInOddsShown = true;
  }

  updateAllInOdds() {
    if (!this.allInOddsShown) return;
    const activeEntries = this.getActiveEntries();
    if (activeEntries.length <= 1) return;
    this.applyAllInOdds(activeEntries);
  }

  applyAllInOdds(activeEntries) {
    const odds = estimateAllInOdds(
      activeEntries,
      this.state.communityCards,
      this.config.allInOddsTrials
    );
    this.ui.setOdds(odds);
  }

  getActiveEntries() {
    return this.state.players
      .map((player, seat) => ({ seat, player }))
      .filter(({ player }) => !player.folded);
  }

  async waitForPlayerAction() {
    return new Promise((resolve) => {
      this.pendingActionResolver = resolve;
      this.updateButtonState();
    });
  }

  async runOutRemaining() {
    this.state.clearBets();
    this.ui.clearBetIndicators();
    while (this.state.stage !== "river") {
      this.state.stage = this.getNextStage(this.state.stage);
      await this.dealCurrentStage();
    }
    await this.resolveShowdown();
  }

  getNextStage(stage) {
    const index = STAGE_ORDER.indexOf(stage);
    if (index < 0 || index >= STAGE_ORDER.length - 1) {
      return "river";
    }
    return STAGE_ORDER[index + 1];
  }

  async dealCurrentStage() {
    if (this.state.stage === "flop") {
      await this.dealFlop();
      return;
    }
    if (this.state.stage === "turn") {
      await this.dealTurn();
      return;
    }
    if (this.state.stage === "river") {
      await this.dealRiver();
    }
  }

  awardPotByFold() {
    const winner = this.state.activePlayers()[0];
    if (!winner) return;

    this.syncPotFromContributions();
    winner.chips += this.state.pot;
    this.state.pot = 0;
    this.ui.updatePot(0, `${winner.name} wins`);
    this.ui.updateNpcLabels(this.state.players);
    this.ui.clearBetIndicators();
  }

  async resolveShowdown() {
    const activePlayers = this.state.activePlayers();
    if (!activePlayers.length) {
      return;
    }

    this.refundUncalledAllInExcess();
    this.syncPotFromContributions();

    const activeSeats = this.state.players
      .map((player, seat) => (player.folded ? null : seat))
      .filter((seat) => seat != null);
    this.ui.revealNpcCards(this.state.players, activeSeats);

    const scores = new Map();
    for (const seat of activeSeats) {
      const player = this.state.players[seat];
      const cards = [...player.holeCards, ...this.state.communityCards.filter(Boolean)];
      scores.set(seat, bestScore(cards));
    }

    const payouts = new Map();
    const sidePots = this.buildSidePots();
    let splitOccurred = false;
    let mainPotWinners = [];

    for (let potIndex = 0; potIndex < sidePots.length; potIndex += 1) {
      const pot = sidePots[potIndex];
      if (!pot.eligibleSeats.length) continue;
      let best = -1;
      const winners = [];
      for (const seat of pot.eligibleSeats) {
        const score = scores.get(seat);
        if (score == null) continue;
        if (score > best) {
          best = score;
          winners.length = 0;
          winners.push(seat);
        } else if (score === best) {
          winners.push(seat);
        }
      }
      if (potIndex === 0) {
        mainPotWinners = [...winners];
      }
      if (winners.length > 1) {
        splitOccurred = true;
      }
      this.distributePot(pot.amount, winners, payouts);
    }

    const payoutWinners = [];
    for (const [seat, amount] of payouts.entries()) {
      if (amount <= 0) continue;
      this.state.players[seat].chips += amount;
      payoutWinners.push(seat);
    }

    this.state.pot = 0;
    this.ui.updateNpcLabels(this.state.players);
    this.ui.updatePot(0, this.buildShowdownMessage({
      splitOccurred,
      mainPotWinners,
      payoutWinners,
      activePlayers,
    }));
    this.ui.clearBetIndicators();
  }

  refundUncalledAllInExcess() {
    const activeEntries = this.state.players
      .map((player, seat) => ({ player, seat }))
      .filter(({ player }) => !player.folded);
    if (activeEntries.length < 2) return;

    const sorted = [...activeEntries].sort(
      (a, b) => (b.player.totalContribution || 0) - (a.player.totalContribution || 0)
    );
    const top = sorted[0];
    const second = sorted[1];
    const topContribution = top.player.totalContribution || 0;
    const secondContribution = second.player.totalContribution || 0;
    const excess = topContribution - secondContribution;

    if (excess <= 0) return;
    if (!top.player.allIn) return;

    top.player.totalContribution -= excess;
    top.player.currentBet = Math.max(0, top.player.currentBet - excess);
    top.player.chips += excess;
    top.player.allIn = top.player.chips === 0;
    this.state.pot = Math.max(0, this.state.pot - excess);
    this.state.currentBet = this.state.players.reduce(
      (highest, player) => (player.folded ? highest : Math.max(highest, player.currentBet)),
      0
    );

    this.ui.setBetAmount(top.seat, top.player.currentBet);
    this.ui.updateNpcLabels(this.state.players);
    this.ui.updatePot(this.state.pot, `${top.player.name} refunded ${formatChips(excess)}`);
  }

  buildSidePots() {
    const contributors = this.state.players
      .map((player, seat) => ({ seat, player, total: player.totalContribution || 0 }))
      .filter((entry) => entry.total > 0);

    if (!contributors.length) {
      return [];
    }

    const levels = [...new Set(contributors.map((entry) => entry.total))].sort((a, b) => a - b);
    const sidePots = [];
    let previousLevel = 0;

    for (const level of levels) {
      const inThisLayer = contributors.filter((entry) => entry.total >= level);
      const layerSize = level - previousLevel;
      const amount = layerSize * inThisLayer.length;
      previousLevel = level;
      if (amount <= 0) continue;

      const eligibleSeats = inThisLayer
        .filter((entry) => !entry.player.folded)
        .map((entry) => entry.seat);
      sidePots.push({
        amount,
        eligibleSeats: eligibleSeats.length ? eligibleSeats : this.getFallbackEligibleSeats(),
      });
    }

    return sidePots;
  }

  getFallbackEligibleSeats() {
    return this.state.players
      .map((player, seat) => ({ player, seat }))
      .filter(({ player }) => !player.folded)
      .map(({ seat }) => seat);
  }

  distributePot(amount, winnerSeats, payouts) {
    if (!winnerSeats.length || amount <= 0) return;
    const ordered = [...winnerSeats].sort((a, b) => a - b);
    const share = Math.floor(amount / ordered.length);
    let remainder = amount % ordered.length;
    for (const seat of ordered) {
      const payout = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      payouts.set(seat, (payouts.get(seat) || 0) + payout);
    }
  }

  getFirstWinnerName(payouts) {
    for (const [seat, amount] of payouts.entries()) {
      if (amount > 0) {
        return this.state.players[seat]?.name || "";
      }
    }
    return "";
  }

  buildShowdownMessage({ splitOccurred, mainPotWinners, payoutWinners, activePlayers }) {
    if (payoutWinners.length <= 1) {
      const winnerSeat = payoutWinners[0];
      const winnerName =
        winnerSeat != null
          ? this.state.players[winnerSeat]?.name
          : activePlayers[0]?.name;
      return `${winnerName || "Player"} wins showdown`;
    }

    if (splitOccurred) {
      return "Split pot";
    }

    if (mainPotWinners.length === 1) {
      const mainWinnerName = this.state.players[mainPotWinners[0]]?.name || "Player";
      return `${mainWinnerName} wins main pot`;
    }

    return "Multiple side-pot winners";
  }

  syncPotFromContributions() {
    this.state.pot = this.state.players.reduce(
      (sum, player) => sum + Math.max(0, player.totalContribution || 0),
      0
    );
  }

  postBlinds() {
    const interval = Math.max(1, this.config.blindIncreaseHands);
    const level = Math.max(0, Math.floor(this.state.handCount / interval));
    this.smallBlind = this.config.smallBlind * (1 << level);
    this.bigBlind = Math.max(this.config.bigBlind * (1 << level), this.smallBlind * 2);

    const smallIndex = this.getSeatAtDealerOffset(1);
    const bigIndex = this.getSeatAtDealerOffset(2);
    this.state.postBlind(smallIndex, this.smallBlind);
    this.state.postBlind(bigIndex, this.bigBlind);
    this.ui.setBetAmount(smallIndex, this.state.players[smallIndex].currentBet);
    this.ui.setBetAmount(bigIndex, this.state.players[bigIndex].currentBet);
  }

  getDealOrder() {
    const count = this.state.players.length;
    const order = [];
    for (let i = 1; i <= count; i += 1) {
      order.push(this.getSeatAtDealerOffset(i));
    }
    return order;
  }

  getPreFlopStart() {
    return this.getSeatAtDealerOffset(3);
  }

  getPostFlopStart() {
    return this.getSeatAtDealerOffset(1);
  }

  getSeatAtDealerOffset(offset) {
    const count = this.state.players.length;
    if (!count || !this.seatOrder.length) {
      return 0;
    }
    const dealerPos = this.state.dealerIndex % count;
    return this.seatOrder[(dealerPos + offset) % count];
  }

  nextPlayerIndex(current) {
    const count = this.state.players.length;
    const currentPos = this.seatOrder.indexOf(current);
    if (currentPos === -1) {
      return (current + 1) % count;
    }
    return this.seatOrder[(currentPos + 1) % count];
  }

  canRaise(player) {
    const callAmount = Math.max(0, this.state.currentBet - player.currentBet);
    const minRaise = this.getMinRaise();
    const maxRaisesPerRound = Number(this.config.maxRaisesPerRound);
    const hasRaiseCap = Number.isFinite(maxRaisesPerRound) && maxRaisesPerRound > 0;
    const underRaiseCap = !hasRaiseCap || this.raiseCount < maxRaisesPerRound;
    return player.chips - callAmount >= minRaise && underRaiseCap;
  }

  hasAnyAllIn() {
    return this.state.activePlayers().some((player) => player.allIn);
  }

  getDealerSeat() {
    return this.getSeatAtDealerOffset(0);
  }

  buildSeatOrder() {
    const count = this.config.npcCount + 1;
    if (Array.isArray(this.config.seatOrder) && this.config.seatOrder.length === count) {
      return [...this.config.seatOrder];
    }
    if (count === 4) {
      return [1, 2, 0, 3];
    }
    return Array.from({ length: count }, (_, index) => index);
  }
}
