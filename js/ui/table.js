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
    this.npcLabels = this.buildSeatMap("[data-seat-label]", "seatLabel");
    this.oddsLabels = this.buildSeatMap("[data-seat-odds]", "seatOdds");
    this.betLabels = this.buildSeatMap("[data-seat-bet]", "seatBet");
    this.dealerLabels = this.buildSeatMap("[data-seat-dealer]", "seatDealer");

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
    this.reducedMotionQuery =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

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

  buildSeatMap(selector, datasetKey) {
    const map = new Map();
    const labels = Array.from(document.querySelectorAll(selector));
    for (const label of labels) {
      const seat = Number(label.dataset[datasetKey]);
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
        this.setHidden(label, true);
        label.style.backgroundColor = "";
        label.style.color = "";
        continue;
      }
      const percent = Math.round(odds * 100);
      label.textContent = `ODDS ${percent}%`;
      this.setHidden(label, false);
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
      this.setHidden(label, true);
      return;
    }
    label.textContent = formatChips(amount);
    this.setHidden(label, false);
  }

  clearBetIndicators() {
    for (const label of this.betLabels.values()) {
      label.textContent = "";
      this.setHidden(label, true);
    }
  }

  setDealerSeat(seat) {
    for (const [key, label] of this.dealerLabels.entries()) {
      if (!label) continue;
      this.setHidden(label, key !== seat);
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
    if (seat === 0) {
      this.applyFoldState(this.playerCards, folded,seat);
      return;
    }
    this.applyFoldState(this.npcCards.get(seat), folded,seat);
  }

  clearFoldStates() {
    this.setFoldedSeat(0, false);
    for (const seat of this.npcCards.keys()) {
      this.setFoldedSeat(seat, false);
    }
  }

  applyFoldState(cards, folded,seat) {
    if (!cards) return;
    const filterValue = folded ? "grayscale(100%)" : "none";
    const opacityValue = folded ? "0.5" : "1";
    for (const card of cards) {
      if (!card) continue;

      if(seat == 0 && folded){
        console.log("helo")
        card.classList.add("translate-y-20")
      } else {
        card.classList.remove("translate-y-20")
      }

      card.style.filter = filterValue;
      card.style.opacity = opacityValue;
    }
  }

  resetTable() {
    this.clearOdds();
    this.clearShowdownHighlights();
    this.clearBetIndicators();
    this.clearFoldStates();
    this.hideRaisePanel();
    this.clearCardList(this.playerCards);
    this.resetCommunityCards();
    for (const cards of this.npcCards.values()) {
      this.clearCardList(cards);
    }
    this.setDeckVisible(true);
    this.updateBurnPile(0);
  }

  getNpcCardElement(seat, index) {
    const cards = this.npcCards.get(seat);
    if (!cards || !cards[index]) return null;
    return cards[index];
  }

  setCardVisual(element, assetPath, opacity = "1") {
    if (!element) return;
    element.style.backgroundImage = assetPath ? `url("${assetPath}")` : "none";
    element.style.backgroundRepeat = "no-repeat";
    element.style.backgroundPosition = "center";
    element.style.backgroundSize = "contain";
    element.style.opacity = opacity;
  }

  setHidden(element, hidden) {
    if (!element) return;
    if (hidden) {
      element.classList.add("hidden");
      return;
    }
    element.classList.remove("hidden");
  }

  clearCardList(cards) {
    if (!cards) return;
    for (const card of cards) {
      if (!card) continue;
      this.clearCard(card);
    }
  }

  resetCommunityCards() {
    for (const slot of this.communityCards) {
      if (!slot?.back || !slot?.front || !slot?.container) continue;
      this.clearCard(slot.back);
      this.clearCard(slot.front);
      slot.container.classList.remove("flipped");
      slot.container.classList.remove("deal-fade");
      slot.container.style.transform = "";
      slot.container.style.opacity = "0";
      slot.container.style.visibility = "hidden";
    }
  }

  setPlayerCard(index, card) {
    const target = this.playerCards[index];
    if (!target) return;
    this.setCardVisual(target, cardToAsset(card));
    this.flashCard(target);
  }

  setNpcCard(seat, index, card, reveal) {
    const cards = this.npcCards.get(seat);
    if (!cards || !cards[index]) return;
    const element = cards[index];
    this.setCardVisual(element, reveal ? cardToAsset(card) : CARD_BACK_ASSET);
    this.flashCard(element);
  }

  setCommunityCard(index, card) {
    const slot = this.communityCards[index];
    if (!slot || !slot.back || !slot.front || !slot.container || !card) return;
    const cardAsset = cardToAsset(card);
    slot.container.style.visibility = "visible";
    this.setCardVisual(slot.back, cardAsset);
    this.setCardVisual(slot.front, cardAsset);
    slot.container.classList.remove("flipped");
    slot.container.style.transform = "";
    slot.container.style.opacity = "1";
    this.flashCard(slot.container);
  }

  async waitForRect(element, maxFrames = 8) {
    if (!element) return null;
    let rect = element.getBoundingClientRect();
    let frame = 0;
    while ((!rect.width || !rect.height) && frame < maxFrames) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      rect = element.getBoundingClientRect();
      frame += 1;
    }
    return rect;
  }

  async animateDealTo(target) {
    if (!this.deckPile || !target) return;
    const duration = this.config.dealAnimationMs || 250;
    if (this.reducedMotionQuery?.matches) {
      await sleep(Math.max(40, Math.floor(duration * 0.35)));
      return;
    }
    const [deckRect, targetRect] = await Promise.all([
      this.waitForRect(this.deckPile),
      this.waitForRect(target),
    ]);
    if (!deckRect.width || !deckRect.height || !targetRect.width || !targetRect.height) {
      await sleep(Math.max(60, Math.floor(duration * 0.5)));
      return;
    }

    const fly = document.createElement("div");
    fly.className = "deal-fly";
    fly.style.width = `${deckRect.width}px`;
    fly.style.height = `${deckRect.height}px`;
    fly.style.left = `${deckRect.left}px`;
    fly.style.top = `${deckRect.top}px`;
    fly.style.backgroundImage = `url("${CARD_BACK_ASSET}")`;
    fly.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
    fly.style.transformOrigin = "top left";
    fly.style.transform = "translate3d(0, 0, 0) scale(1, 1)";
    fly.style.opacity = "0.96";

    document.body.appendChild(fly);

    const scaleX = targetRect.width / deckRect.width;
    const scaleY = targetRect.height / deckRect.height;
    const translateX = targetRect.left - deckRect.left;
    const translateY = targetRect.top - deckRect.top;
    const maxTilt = this.config.dealTiltMaxDeg ?? 7;
    const tilt = Math.max(-maxTilt, Math.min(maxTilt, translateX / 85));
    const settleMs = this.config.dealSettleBufferMs ?? 90;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        fly.removeEventListener("transitionend", onTransitionEnd);
        resolve();
      };
      const onTransitionEnd = (event) => {
        if (event.target !== fly || event.propertyName !== "transform") return;
        clearTimeout(timer);
        finish();
      };
      const timer = setTimeout(finish, duration + settleMs);
      fly.addEventListener("transitionend", onTransitionEnd);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fly.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY}) rotate(${tilt}deg)`;
          fly.style.opacity = "1";
        });
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
    this.setCardVisual(this.deckPile, CARD_BACK_ASSET);
  }

  updateBurnPile(count) {
    if (!this.burnPile) return;
    if (!count) {
      this.clearCard(this.burnPile);
      return;
    }
    this.setCardVisual(this.burnPile, CARD_BACK_ASSET);
  }

  flashCard(element) {
    if (!element) return;
    element.classList.add("deal-fade");
    setTimeout(() => element.classList.remove("deal-fade"), 320);
  }

  clearCard(element) {
    this.setCardVisual(element, null, "0");
  }

  showGameOver() {
    const modal = document.getElementById("game-over-modal");
    if (modal) {
      modal.classList.remove("hidden");
    }
  }

  showOtherPlayBtn() {
    const playBtn = document.getElementById("play-btn-2");
    if (playBtn) {
      playBtn.classList.remove("hidden");
    }
  }
  hideOtherPlayBtn() {
    const playBtn = document.getElementById("play-btn-2");
    if (playBtn) {
      playBtn.classList.add("hidden");
    }
  }

  hideGameOver() {
    const modal = document.getElementById("game-over-modal");
    if (modal) {
      modal.classList.add("hidden");
    }
  }

  async highlightWinningNpcCards(winnerSeats) {
    // Add animation to winning NPC cards
    for (const seat of winnerSeats) {
      const cardSlots = this.npcCards.get(seat);
      if (cardSlots) {
        for (const card of cardSlots) {
          if (card) {
            card.classList.add("winning-npc-card");
          }
        }
      }
    }

    // Wait 3 seconds
    await new Promise((resolve) => setTimeout(resolve, this.config.winAnimationMs || 3000));

    // Remove animation
    for (const seat of winnerSeats) {
      const cardSlots = this.npcCards.get(seat);
      if (cardSlots) {
        for (const card of cardSlots) {
          if (card) {
            card.classList.remove("winning-npc-card");
          }
        }
      }
    }
  }
}
