import { GAME_CONFIG } from "./game/config.js";
import { GameState } from "./game/state.js";
import { NpcBrain, createNpcProfile } from "./game/ai.js";
import { GameController } from "./game/controller.js";
import { TableUI } from "./ui/table.js";

const config = { ...GAME_CONFIG };

const ui = new TableUI(config);
const state = new GameState(config, () => createNpcProfile(config.difficulty));
state.setupPlayers();
ui.updateNpcLabels(state.players);
ui.updatePot(0, "");

const controller = new GameController(state, ui, config, new NpcBrain());
controller.updateButtonState();

const btnNewHand = document.getElementById("btn-newhand");
const btnFold = document.getElementById("btn-fold");
const btnCall = document.getElementById("btn-call");
const btnRaise = document.getElementById("btn-raise");
const btnAllIn = document.getElementById("btn-allin");

if (btnNewHand) {
  btnNewHand.addEventListener("click", () => controller.startHand());
}

if (btnFold) {
  btnFold.addEventListener("click", () => {
    ui.hideRaisePanel();
    controller.queuePlayerAction({ action: "fold" });
  });
}

if (btnCall) {
  btnCall.addEventListener("click", () => {
    ui.hideRaisePanel();
    controller.queuePlayerAction({ action: "call" });
  });
}

if (btnRaise) {
  btnRaise.addEventListener("click", () => {
    if (!ui.isRaisePanelOpen()) {
      ui.showRaisePanel();
      return;
    }
    ui.hideRaisePanel();
    controller.queuePlayerAction({ action: "raise", raiseBy: ui.getRaiseValue() });
  });
}

if (btnAllIn) {
  btnAllIn.addEventListener("click", () => {
    ui.hideRaisePanel();
    controller.queuePlayerAction({ action: "allin" });
  });
}

controller.startHand();
