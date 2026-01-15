export const SUITS = [
  { code: "sp", name: "spades" },
  { code: "he", name: "hearts" },
  { code: "di", name: "diamonds" },
  { code: "cl", name: "clubs" },
];

export const VALUES = [
  { label: "2", rank: 2, file: "2" },
  { label: "3", rank: 3, file: "3" },
  { label: "4", rank: 4, file: "4" },
  { label: "5", rank: 5, file: "5" },
  { label: "6", rank: 6, file: "6" },
  { label: "7", rank: 7, file: "7" },
  { label: "8", rank: 8, file: "8" },
  { label: "9", rank: 9, file: "9" },
  { label: "10", rank: 10, file: "10" },
  { label: "jack", rank: 11, file: "jack" },
  { label: "queen", rank: 12, file: "queen" },
  { label: "king", rank: 13, file: "king" },
  { label: "ace", rank: 14, file: "ace" },
];

export const CARD_BACK_ASSET = "assets/standard_cards/card_back_1.svg";

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({
        suit: suit.code,
        suitName: suit.name,
        value: value.file,
        rank: value.rank,
      });
    }
  }
  return deck;
}

export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function cardToAsset(card) {
  return `assets/standard_cards/${card.value}_of_${card.suitName}.svg`;
}

export function cardKey(card) {
  return `${card.rank}-${card.suit}`;
}
