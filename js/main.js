import { GAME_CONFIG } from "./game/config.js";
import { GameState } from "./game/state.js";
import { NpcBrain, createNpcProfile } from "./game/ai.js";
import { GameController } from "./game/controller.js";
import { TableUI } from "./ui/table.js";

const config = { ...GAME_CONFIG };

const ui = new TableUI(config);
const state = new GameState(config, () => createNpcProfile());
state.setupPlayers();
ui.updateNpcLabels(state.players);
ui.updatePot(0, "");

const controller = new GameController(state, ui, config, new NpcBrain());
controller.updateButtonState();

const playBtn = document.getElementById("play-btn");

const titleOverlay = document.getElementById("title-overlay");
const titleScreen = document.getElementById("title-screen");

let gameStarted = false;

function startGameIfNeeded() {
  if (gameStarted) return;
  gameStarted = true;
  controller.startHand();
}

function queueAction(action) {
  ui.hideRaisePanel();
  controller.queuePlayerAction(action);
}

function bindClick(id, handler) {
  const element = document.getElementById(id);
  if (!element) return;
  element.addEventListener("click", handler);
}

if (playBtn) {
  playBtn.addEventListener("click", () => {
    titleOverlay?.classList.add("hidden");
    titleScreen?.classList.add("hidden");
    startGameIfNeeded();
  });
} else {
  startGameIfNeeded();
}

bindClick("btn-newhand", () => controller.startHand());
bindClick("btn-fold", () => queueAction({ action: "fold" }));
bindClick("btn-call", () => queueAction({ action: "call" }));
bindClick("btn-raise", () => {
  if (!ui.isRaisePanelOpen()) {
    ui.showRaisePanel();
    return;
  }
  queueAction({ action: "raise", raiseBy: ui.getRaiseValue() });
});
bindClick("btn-allin", () => queueAction({ action: "allin" }));

bindClick("btn-play-again", () => {
  // Reset the game state for a new game
  state.setupPlayers();
  ui.updateNpcLabels(state.players);
  ui.updatePot(0, "");
  ui.hideGameOver();
  controller.updateButtonState();
  controller.startHand();
});
