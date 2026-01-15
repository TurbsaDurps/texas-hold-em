export const suits = ["sp", "he", "di", "cl"];
export const values = ["2","3","4","5","6","7","8","9","10","jack","queen","king","ace"];

export function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

