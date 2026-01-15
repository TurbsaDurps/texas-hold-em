import { CARD_BACK_ASSET, cardToAsset } from "../core/cards.js";
import { sleep, formatChips } from "../core/utils.js";

export class TableUI {
  constructor(config) {
    this.config = config;
    this.playerCards = [
      document.getElementById("hand-1"),
      document.getElementById("hand-2"),
    ];
    this.communityCards = Array.from({ length: 5 }).map((_, index) => {
      const back = document.getElementById(`house-${index + 1}`);
      return {
        back,
        front: document.getElementById(`house-${index + 1}-front`),
        container: back ? back.parentElement : null,
      };
    });
    this.npcCards = this.buildNpcMap();
    this.npcLabels = this.buildNpcLabelMap();
    this.oddsLabels = this.buildOddsLabelMap();
    this.betLabels = this.buildBetLabelMap();
    this.dealerLabels = this.buildDealerLabelMap();

    this.potTotal = document.getElementById("pot-total");
    this.potChange = document.getElementById("pot-change");

    this.deckPile = document.getElementById("deck-pile");
    this.burnPile = document.getElementById("burn-pile");

    this.raiseSlider = document.getElementById("raise-slider");
    this.raiseAmountLabel = document.getElementById("raise-amount");
    this.raisePanel = document.getElementById("raise-panel");

    this.foldButton = document.getElementById("btn-fold");
    this.callButton = document.getElementById("btn-call");
    this.raiseButton = document.getElementById("btn-raise");
    this.allInButton = document.getElementById("btn-allin");

    this.raiseValue = 0;
    this.raisePanelOpen = false;
    this.lastPotStatus = "";
    this.announcementToken = 0;
    this.bindSlider();
    this.resetTable();
  }

  buildNpcMap() {
    const map = new Map();
    const cards = Array.from(document.querySelectorAll(".npc-card"));
    for (const card of cards) {
      const seat = Number(card.dataset.seat);
      const slot = Number(card.dataset.card);
      if (!map.has(seat)) {
        map.set(seat, []);
      }
      map.get(seat)[slot] = card;
    }
    return map;
  }

  buildNpcLabelMap() {
    const map = new Map();
    const labels = Array.from(document.querySelectorAll("[data-seat-label]"));
    for (const label of labels) {
      const seat = Number(label.dataset.seatLabel);
      map.set(seat, label);
    }
    return map;
  }

  buildOddsLabelMap() {
    const map = new Map();
    const labels = Array.from(document.querySelectorAll("[data-seat-odds]"));
    for (const label of labels) {
      const seat = Number(label.dataset.seatOdds);
      map.set(seat, label);
    }
    return map;
  }

  buildBetLabelMap() {
    const map = new Map();
    const labels = Array.from(document.querySelectorAll("[data-seat-bet]"));
    for (const label of labels) {
      const seat = Number(label.dataset.seatBet);
      map.set(seat, label);
    }
    return map;
  }

  buildDealerLabelMap() {
    const map = new Map();
    const labels = Array.from(document.querySelectorAll("[data-seat-dealer]"));
    for (const label of labels) {
      const seat = Number(label.dataset.seatDealer);
      map.set(seat, label);
    }
    return map;
  }

  bindSlider() {
    if (!this.raiseSlider || !this.raiseAmountLabel) {
      return;
    }
    this.raiseSlider.addEventListener("input", () => {
      this.raiseValue = Number(this.raiseSlider.value);
      this.raiseAmountLabel.textContent = `Raise: ${this.raiseValue}`;
    });
  }

  isRaisePanelOpen() {
    return this.raisePanelOpen;
  }

  showRaisePanel() {
    if (!this.raisePanel) return;
    this.raisePanelOpen = true;
    this.raisePanel.classList.remove("hidden");
  }

  hideRaisePanel() {
    if (!this.raisePanel) return;
    this.raisePanelOpen = false;
    this.raisePanel.classList.add("hidden");
  }

  toggleRaisePanel() {
    if (this.raisePanelOpen) {
      this.hideRaisePanel();
    } else {
      this.showRaisePanel();
    }
  }

  setRaiseRange(min, max, value, step = 1) {
    if (!this.raiseSlider || !this.raiseAmountLabel) {
      return;
    }
    const safeMin = Math.max(0, Math.floor(min));
    const safeMax = Math.max(safeMin, Math.floor(max));
    const safeStep = Math.max(1, Math.floor(step));
    const safeValue = Math.max(
      safeMin,
      Math.min(safeMax, Math.floor(value / safeStep) * safeStep)
    );
    this.raiseSlider.min = String(safeMin);
    this.raiseSlider.max = String(safeMax);
    this.raiseSlider.value = String(safeValue);
    this.raiseSlider.step = String(safeStep);
    this.raiseValue = safeValue;
    this.raiseAmountLabel.textContent = `Raise: ${safeValue}`;
  }

  getRaiseValue() {
    return this.raiseValue || 0;
  }

  setRaiseEnabled(enabled) {
    if (!this.raiseSlider) return;
    this.raiseSlider.disabled = !enabled;
  }

  setButtonsEnabled({ canFold, canCall, canRaise, canAllIn, callLabel, raiseLabel }) {
    if (this.foldButton) {
      this.foldButton.disabled = !canFold;
    }
    if (this.callButton) {
      this.callButton.disabled = !canCall;
      this.callButton.textContent = callLabel || "CALL";
    }
    if (this.raiseButton) {
      this.raiseButton.disabled = !canRaise;
      const label =
        this.raiseButton.querySelector("[data-raise-label]") ||
        this.raiseButton.querySelector("h1");
      if (label) {
        label.textContent = raiseLabel || "※RAISE";
      }
    }
    if (this.allInButton) {
      this.allInButton.disabled = !canAllIn;
    }
    this.setRaiseEnabled(canRaise);
    if (!canRaise) {
      this.hideRaisePanel();
    }
  }

  updatePot(total, deltaText = "") {
    if (this.potTotal) {
      this.potTotal.textContent = formatChips(total);
    }
    if (this.potChange) {
      this.potChange.textContent = deltaText || "";
    }
    this.lastPotStatus = deltaText || "";
  }

  showAnnouncement(message, durationMs) {
    if (!this.potChange) return;
    const token = ++this.announcementToken;
    this.potChange.textContent = message;
    setTimeout(() => {
      if (this.announcementToken !== token) return;
      if (this.potChange.textContent === message) {
        this.potChange.textContent = this.lastPotStatus || "";
      }
    }, durationMs);
  }

  updateNpcLabels(players) {
    for (let seat = 0; seat < players.length; seat += 1) {
      const label = this.npcLabels.get(seat);
      if (!label) continue;
      const player = players[seat];
      const status = player.folded ? "(fold)" : player.allIn ? "(all in)" : "";
      if (seat === 0) {
        label.textContent = `CHIPS ${formatChips(player.chips)}`;
      } else {
        label.textContent = `${player.name} • ${formatChips(player.chips)} ${status}`.trim();
      }
    }
  }

  setOdds(oddsBySeat) {
    for (const [seat, label] of this.oddsLabels.entries()) {
      const odds = oddsBySeat ? oddsBySeat[seat] : null;
      if (odds == null) {
        label.textContent = "";
        label.classList.add("hidden");
        label.style.backgroundColor = "";
        label.style.color = "";
        continue;
      }
      const percent = Math.round(odds * 100);
      label.textContent = `ODDS ${percent}%`;
      label.classList.remove("hidden");
      if (percent > 75) {
        label.style.backgroundColor = "#16a34a";
        label.style.color = "#ffffff";
      } else if (percent < 30) {
        label.style.backgroundColor = "#dc2626";
        label.style.color = "#ffffff";
      } else {
        label.style.backgroundColor = "#6b7280";
        label.style.color = "#ffffff";
      }
    }
  }

  clearOdds() {
    this.setOdds(null);
  }

  setBetAmount(seat, amount) {
    const label = this.betLabels.get(seat);
    if (!label) return;
    if (!amount || amount <= 0) {
      label.textContent = "";
      label.classList.add("hidden");
      return;
    }
    label.textContent = formatChips(amount);
    label.classList.remove("hidden");
  }

  clearBetIndicators() {
    for (const label of this.betLabels.values()) {
      label.textContent = "";
      label.classList.add("hidden");
    }
  }

  setDealerSeat(seat) {
    for (const [key, label] of this.dealerLabels.entries()) {
      if (!label) continue;
      if (key === seat) {
        label.classList.remove("hidden");
      } else {
        label.classList.add("hidden");
      }
    }
  }

  highlightShowdownSeats(seats) {
    const seatSet = new Set(seats || []);
    for (const [seat, cards] of this.npcCards.entries()) {
      const highlight = seatSet.has(seat);
      for (const card of cards || []) {
        if (!card) continue;
        card.style.scale = highlight ? "1.12" : "1";
      }
    }
  }

  clearShowdownHighlights() {
    this.highlightShowdownSeats([]);
  }

  setFoldedSeat(seat, folded) {
    const filterValue = folded ? "grayscale(100%)" : "none";
    if (seat === 0) {
      for (const card of this.playerCards) {
        if (!card) continue;
        card.style.filter = filterValue;
        card.style.opacity = "50%"

      }
      return;
    }
    const cards = this.npcCards.get(seat);
    if (!cards) return;
    for (const card of cards) {
      if (!card) continue;
      card.style.filter = filterValue;
      card.style.opacity = "50%"

    }
  }

  clearFoldStates() {
    this.setFoldedSeat(0, false);
    for (const seat of this.npcCards.keys()) {
      this.setFoldedSeat(seat, false);
    }
  }

  resetTable() {
    this.clearOdds();
    this.clearShowdownHighlights();
    this.clearBetIndicators();
    this.clearFoldStates();
    this.hideRaisePanel();
    for (const card of this.playerCards) {
      if (!card) continue;
      this.clearCard(card);
    }
    for (const card of this.communityCards) {
      if (!card.back || !card.front || !card.container) continue;
      card.back.style.backgroundImage = "none";
      card.front.style.backgroundImage = "none";
      card.back.style.backgroundRepeat = "no-repeat";
      card.back.style.backgroundPosition = "center";
      card.back.style.backgroundSize = "contain";
      card.front.style.backgroundRepeat = "no-repeat";
      card.front.style.backgroundPosition = "center";
      card.front.style.backgroundSize = "contain";
      card.container.classList.remove("flipped");
      card.container.style.opacity = "0";
    }
    for (const [seat, cards] of this.npcCards.entries()) {
      if (!cards) continue;
      for (const card of cards) {
        if (!card) continue;
        this.clearCard(card);
      }
    }
    this.setDeckVisible(true);
    this.updateBurnPile(0);
  }

  getNpcCardElement(seat, index) {
    const cards = this.npcCards.get(seat);
    if (!cards || !cards[index]) return null;
    return cards[index];
  }

  setPlayerCard(index, card) {
    const target = this.playerCards[index];
    if (!target) return;
    target.style.backgroundImage = `url("${cardToAsset(card)}")`;
    target.style.backgroundRepeat = "no-repeat";
    target.style.backgroundPosition = "center";
    target.style.backgroundSize = "contain";
    target.style.opacity = "1";
    this.flashCard(target);
  }

  setNpcCard(seat, index, card, reveal) {
    const cards = this.npcCards.get(seat);
    if (!cards || !cards[index]) return;
    const element = cards[index];
    element.style.backgroundImage = reveal
      ? `url("${cardToAsset(card)}")`
      : `url("${CARD_BACK_ASSET}")`;
    element.style.backgroundRepeat = "no-repeat";
    element.style.backgroundPosition = "center";
    element.style.backgroundSize = "contain";
    element.style.opacity = "1";
    this.flashCard(element);
  }

  setCommunityCard(index, card) {
    const slot = this.communityCards[index];
    if (!slot || !slot.front || !slot.container) return;
    slot.front.style.backgroundImage = `url("${cardToAsset(card)}")`;
    slot.front.style.backgroundRepeat = "no-repeat";
    slot.front.style.backgroundPosition = "center";
    slot.front.style.backgroundSize = "contain";
    slot.container.classList.add("flipped");
    slot.container.style.opacity = "1";
    this.flashCard(slot.container);
  }

  async animateDealTo(target) {
    if (!this.deckPile || !target) return;
    const deckRect = this.deckPile.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (!deckRect.width || !deckRect.height || !targetRect.width || !targetRect.height) {
      return;
    }

    const fly = document.createElement("div");
    fly.className = "deal-fly";
    fly.style.width = `${deckRect.width}px`;
    fly.style.height = `${deckRect.height}px`;
    fly.style.left = `${deckRect.left}px`;
    fly.style.top = `${deckRect.top}px`;
    fly.style.backgroundImage = `url("${CARD_BACK_ASSET}")`;
    const duration = this.config.dealAnimationMs || 250;
    fly.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
    fly.style.transformOrigin = "top left";

    document.body.appendChild(fly);

    const scaleX = targetRect.width / deckRect.width;
    const scaleY = targetRect.height / deckRect.height;
    const translateX = targetRect.left - deckRect.left;
    const translateY = targetRect.top - deckRect.top;

    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        fly.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
        setTimeout(resolve, duration + 30);
      });
    });

    fly.remove();
  }

  async dealHoleCards(order, players, delayMs) {
    for (let round = 0; round < 2; round += 1) {
      for (const seat of order) {
        const player = players[seat];
        if (!player) continue;
        const card = player.holeCards[round];
        if (!card) continue;
        const target = player.isHuman
          ? this.playerCards[round]
          : this.getNpcCardElement(seat, round);
        await this.animateDealTo(target);
        if (player.isHuman) {
          this.setPlayerCard(round, card);
        } else {
          this.setNpcCard(seat, round, card, false);
        }
        await sleep(delayMs);
      }
    }
  }

  async dealCommunity(cards, delayMs, onCardDealt) {
    for (const entry of cards) {
      if (entry == null) continue;
      const { index, card } = entry;
      const target = this.communityCards[index]?.back || this.communityCards[index]?.container;
      await this.animateDealTo(target);
      this.setCommunityCard(index, card);
      if (onCardDealt) {
        onCardDealt();
      }
      await sleep(delayMs);
    }
  }

  revealNpcCards(players, showdownSeats = []) {
    this.highlightShowdownSeats(showdownSeats);
    for (let seat = 1; seat < players.length; seat += 1) {
      const player = players[seat];
      if (!player || player.folded) continue;
      for (let i = 0; i < player.holeCards.length; i += 1) {
        const card = player.holeCards[i];
        if (card) {
          this.setNpcCard(seat, i, card, true);
        }
      }
    }
  }

  setDeckVisible(visible) {
    if (!this.deckPile) return;
    if (!visible) {
      this.clearCard(this.deckPile);
      return;
    }
    this.deckPile.style.backgroundImage = `url("${CARD_BACK_ASSET}")`;
    this.deckPile.style.backgroundRepeat = "no-repeat";
    this.deckPile.style.backgroundPosition = "center";
    this.deckPile.style.backgroundSize = "contain";
    this.deckPile.style.opacity = "1";
  }

  updateBurnPile(count) {
    if (!this.burnPile) return;
    if (!count) {
      this.clearCard(this.burnPile);
      return;
    }
    this.burnPile.style.backgroundImage = `url("${CARD_BACK_ASSET}")`;
    this.burnPile.style.backgroundRepeat = "no-repeat";
    this.burnPile.style.backgroundPosition = "center";
    this.burnPile.style.backgroundSize = "contain";
    this.burnPile.style.opacity = "1";
  }

  flashCard(element) {
    if (!element) return;
    element.classList.add("deal-fade");
    setTimeout(() => element.classList.remove("deal-fade"), 320);
  }

  clearCard(element) {
    if (!element) return;
    element.style.backgroundImage = "none";
    element.style.backgroundRepeat = "no-repeat";
    element.style.backgroundPosition = "center";
    element.style.backgroundSize = "contain";
    element.style.opacity = "0";
  }
}
