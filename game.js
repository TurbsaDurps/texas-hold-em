import { createDeck } from "./deck.js";


const bgMusic = new Audio("assets/sound/main_theme.mp3");

let playing = false;

bgMusic.loop = true;
bgMusic.volume = 0.4;
bgMusic.muted = true;

bgMusic.play();

document.addEventListener("click", () => {
  bgMusic.muted = false;
}, { once: true });


const playBtn = document.getElementById("play-btn")
const titleScreen = document.getElementById("title-screen")
const titleOverlay = document.getElementById("title-overlay")


playBtn.addEventListener("click", () => {
  console.log("hi :D")
  titleOverlay.style.transform = "translateY(-100%)";
  titleScreen.style.opacity = "0";
  titleOverlay.classList.add("hidden")
});



const card_type = "standard_cards"

// ==========================
// DECK / DEAL LOGIC
// ==========================
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function deal(deck, count) {
  return deck.splice(0, count);
}

// ==========================
// GAME SETUP
// ==========================

const deck = shuffle(createDeck());

const players = [{ id: 1, hand: deal(deck, 2) }];

const HOUSE_CARD_COUNT = 5;
const house = {
  hand: deal(deck, HOUSE_CARD_COUNT),
};

console.log("Players:", players);
console.log("House:", house);
console.log("Remaining deck:", deck.length);

// ==========================
// CARD → SVG MAPPER
// ==========================

function cardToAsset(card) {
    console.log(card)
  const suitMap = {
    "sp": "spades",
    "he": "hearts",
    "di": "diamonds",
    "cl": "clubs",
  };

  return `url("assets/${card_type}/${card.value}_of_${suitMap[card.suit]}.svg")`;
}

// ==========================
// PLAYER HAND UI
// ==========================

const hand_doc = document.getElementById("hand-1");
const hand_doc2 = document.getElementById("hand-2");

const player = players[0];

console.log("hand",player)

if (player.hand[0] && hand_doc) {
  hand_doc.style.backgroundImage = cardToAsset(player.hand[0]);
  hand_doc.style.backgroundRepeat = "no-repeat";
  hand_doc.style.backgroundPosition = "center";
  hand_doc.style.backgroundSize = "contain";
}

if (player.hand[1] && hand_doc2) {
  hand_doc2.style.backgroundImage = cardToAsset(player.hand[1]);
  hand_doc2.style.backgroundRepeat = "no-repeat";
  hand_doc2.style.backgroundPosition = "center";
  hand_doc2.style.backgroundSize = "contain";
}

// ==========================
// HOUSE CARDS (BACKS)
// ==========================

const CARD_BACK = `url("assets/${card_type}/card_back_1.svg")`;

for (let i = 1; i <= HOUSE_CARD_COUNT; i++) {
  const card = document.getElementById(`house-${i}`);
  if (!card) continue;

  card.style.backgroundImage = CARD_BACK;
  card.style.backgroundRepeat = "no-repeat";
  card.style.backgroundPosition = "center";
  card.style.backgroundSize = "contain";
}

// ==========================
// HOUSE CARDS (FRONTS)
// ==========================

for (let i = 1; i <= HOUSE_CARD_COUNT; i++) {
  const cardFront = document.getElementById(`house-${i}-front`);
  if (!cardFront) continue;

  const houseCard = house.hand[i - 1];
  if (!houseCard) continue;

  cardFront.style.backgroundImage = cardToAsset(houseCard);
  cardFront.style.backgroundRepeat = "no-repeat";
  cardFront.style.backgroundPosition = "center";
  cardFront.style.backgroundSize = "contain";
}

console.log("house cards initialized");

// ==========================
// BUTTON STATE / SWITCH
// ==========================

let state = 0;

function switchbtns() {
  console.log("switch");

  const allin = document.getElementById("btn-allin");
  const raise = document.getElementById("btn-raise");

  if (!allin || !raise) return;

  if (state === 0) {
    allin.classList.remove("translate-y-[205%]");
    raise.classList.add("translate-y-[205%]");
    state = 1;
  } else {
    allin.classList.add("translate-y-[205%]");
    raise.classList.remove("translate-y-[205%]");
    state = 0;
  }
}

console.log("game.js loaded");
