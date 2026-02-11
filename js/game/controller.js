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

    const rebuys = this.state.resetForNewHand(true);
    this.ui.resetTable();
    this.allInOddsShown = false;
    this.ui.setDealerSeat(this.getDealerSeat());
    this.postBlinds();
    this.ui.updateNpcLabels(this.state.players);
    this.ui.updatePot(this.state.pot, `Blinds ${this.smallBlind}/${this.bigBlind}`);
    if (rebuys && rebuys.length) {
      const message = rebuys
        .map((entry) => `${entry.name} buys in for ${formatChips(entry.amount)}`)
        .join(" • ");
      this.ui.showAnnouncement(message, this.config.announcementDurationMs || 2500);
    }

    await sleep(this.config.preDealDelayMs);
    await this.dealHoleCards();
    await this.runBettingRound(this.getPreFlopStart());
    this.handInProgress = false;
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
      const minRaise = Math.max(this.bigBlind || this.config.bigBlind, 1);
      const maxRaise = Math.max(minRaise, player.chips - callAmount);
      this.ui.setRaiseRange(minRaise, maxRaise, minRaise, this.config.smallBlind);
    } else {
      this.ui.setRaiseRange(0, 0, 0, this.config.smallBlind);
    }
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
    this.raiseCount = 0;
    for (const player of this.state.players) {
      player.actedThisRound = false;
      player.raisedThisRound = false;
    }
    let currentIndex = startIndex;
    let actionsPending = this.state.actingPlayers().length;

    if (actionsPending === 0 || (await this.resolveRoundEarlyExit())) {
      return;
    }

    while (true) {
      if (await this.resolveRoundEarlyExit()) {
        return;
      }

      const player = this.state.players[currentIndex];
      if (!player || player.folded || player.allIn) {
        currentIndex = this.nextPlayerIndex(currentIndex);
        continue;
      }

      let isNpc = false;
      if (player.isHuman) {
        const action = await this.waitForPlayerAction();
        const result = this.applyAction(player, action, actionsPending);
        actionsPending = result.actionsPending;
      } else {
        isNpc = true;
        const decision = this.npcBrain.decide(player, this.state, {
          minRaise: this.bigBlind,
          smallBlind: this.config.smallBlind,
          canRaise: this.canRaise(player),
          raiseCount: this.raiseCount,
        });
        const result = this.applyAction(player, decision, actionsPending);
        actionsPending = result.actionsPending;
      }

      this.ui.updateNpcLabels(this.state.players);
      this.ui.updatePot(this.state.pot, `${player.name} ${player.lastAction || "acts"}`);
      if (isNpc) {
        await sleep(this.config.npcThinkDelayMs);
      }

      if (await this.resolveRoundEarlyExit()) {
        return;
      }

      if (actionsPending <= 0) {
        break;
      }

      currentIndex = this.nextPlayerIndex(currentIndex);
    }

    if (this.hasAnyAllIn()) {
      this.showAllInOdds();
      await this.runOutRemaining();
      return;
    }
    await this.advanceStage();
  }

  async resolveRoundEarlyExit() {
    if (this.state.activePlayers().length <= 1) {
      this.awardPotByFold();
      return true;
    }
    if (this.state.actingPlayers().length === 0) {
      this.showAllInOdds();
      await this.runOutRemaining();
      return true;
    }
    return false;
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

  applyAction(player, action, actionsPending) {
    const seat = this.state.players.indexOf(player);
    const callAmount = Math.max(0, this.state.currentBet - player.currentBet);
    const maxTotalBet = player.currentBet + player.chips;
    const actionType = action?.action || "call";

    switch (actionType) {
      case "fold":
        player.folded = true;
        player.lastAction = "folds";
        actionsPending -= 1;
        if (seat >= 0) {
          this.ui.setFoldedSeat(seat, true);
          this.ui.setBetAmount(seat, 0);
        }
        break;
      case "raise":
        if (!this.canRaise(player)) {
          return this.applyAction(player, { action: "call" }, actionsPending);
        }
        const raiseBy = clamp(action.raiseBy || 0, this.bigBlind, player.chips);
        const targetBet = this.state.currentBet + raiseBy;
        const actualRaiseTo = Math.min(targetBet, maxTotalBet);
        if (actualRaiseTo <= this.state.currentBet) {
          return this.applyAction(player, { action: "call" }, actionsPending);
        }
        const needed = Math.max(0, actualRaiseTo - player.currentBet);
        const contributed = takeChips(player, needed);
        player.currentBet += contributed;
        this.state.pot += contributed;
        this.state.currentBet = Math.max(this.state.currentBet, player.currentBet);
        player.raisedThisRound = true;
        player.lastAction = contributed < needed ? "all in" : `raises ${player.currentBet}`;
        this.raiseCount += 1;
        actionsPending = this.state.actingPlayers().length - 1;
        if (seat >= 0) {
          this.ui.setBetAmount(seat, player.currentBet);
        }
        break;
      case "allin":
        if (player.chips <= 0) {
          return this.applyAction(player, { action: "call" }, actionsPending);
        }
        const allInTo = maxTotalBet;
        const allInNeeded = Math.max(0, allInTo - player.currentBet);
        const allInContribution = takeChips(player, allInNeeded);
        player.currentBet += allInContribution;
        this.state.pot += allInContribution;
        if (player.currentBet > this.state.currentBet) {
          this.state.currentBet = player.currentBet;
          player.raisedThisRound = true;
          this.raiseCount += 1;
          actionsPending = this.state.actingPlayers().length - 1;
          player.lastAction = "all in";
        } else {
          actionsPending -= 1;
          player.lastAction = "calls all in";
        }
        if (seat >= 0) {
          this.ui.setBetAmount(seat, player.currentBet);
        }
        break;
      case "call":
      default:
        const paid = takeChips(player, callAmount);
        player.currentBet += paid;
        this.state.pot += paid;
        actionsPending -= 1;
        if (callAmount > 0 && paid < callAmount) {
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

    if (player.chips === 0) {
      player.allIn = true;
    }
    player.actedThisRound = true;

    return { actionsPending };
  }

  async advanceStage() {
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

  async runOutRemaining() {
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
    if (winner) {
      winner.chips += this.state.pot;
      this.ui.updatePot(0, `${winner.name} wins`);
    }
    this.state.pot = 0;
    this.ui.updateNpcLabels(this.state.players);
    this.ui.clearBetIndicators();
  }

  async resolveShowdown() {
    const active = this.state.activePlayers();
    if (!active.length) {
      return;
    }
    this.syncPotFromBets();
    const activeSeats = this.state.players
      .map((player, seat) => (player.folded ? null : seat))
      .filter((seat) => seat != null);
    let best = 0;
    let winners = [];

    for (const player of active) {
      const cards = [...player.holeCards, ...this.state.communityCards.filter(Boolean)];
      const score = bestScore(cards);
      if (score > best) {
        best = score;
        winners = [player];
      } else if (score === best) {
        winners.push(player);
      }
    }

    const share = Math.floor(this.state.pot / winners.length);
    let remainder = this.state.pot % winners.length;
    for (const winner of winners) {
      const payout = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      winner.chips += payout;
    }

    this.ui.revealNpcCards(this.state.players, activeSeats);
    this.ui.updateNpcLabels(this.state.players);

    if (winners.length === 1) {
      this.ui.updatePot(0, `${winners[0].name} wins showdown`);
    } else {
      this.ui.updatePot(0, "Split pot");
    }

    this.state.pot = 0;
    this.ui.clearBetIndicators();
  }

  syncPotFromBets() {
    const betTotal = this.state.players.reduce((sum, player) => sum + player.currentBet, 0);
    if (betTotal > this.state.pot) {
      this.state.pot = betTotal;
    }
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
    return (
      !this.hasAnyAllIn() &&
      player.chips > callAmount &&
      this.raiseCount < this.config.maxRaisesPerRound
    );
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
