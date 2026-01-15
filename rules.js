const rules = [
    "royal_flush",
    "staight_flush",
    "four_kind",
    "full_house",
    "flush",
    "straight",
    "three_kind",
    "two_pair",
    "pair",
    "high_card"
]

export function calc(hand, house) {
    const cards = sort_cards(hand, house);

    const straight = is_straight(hand, house);
    const flush = is_flush(hand, house);

    const counts = {};
    for (const card of cards) {
        counts[card.value] = (counts[card.value] || 0) + 1;
    }

    const frequencies = Object.values(counts).sort((a, b) => b - a);

    // Royal / Straight Flush
    if (straight && flush) {
        const values = [...new Set(cards.map(c => c.value))].sort((a,b)=>a-b);
        const isRoyal = [10,11,12,13,14].every(v => values.includes(v));
        return {
            rule: isRoyal ? "royal_flush" : "straight_flush",
            strength: isRoyal ? 0 : 1
        };
    }

    // Four of a kind
    if (frequencies[0] === 4) {
        return { rule: "four_kind", strength: 2 };
    }

    // Full house
    if (frequencies[0] === 3 && frequencies[1] >= 2) {
        return { rule: "full_house", strength: 3 };
    }

    // Flush
    if (flush) {
        return { rule: "flush", strength: 4 };
    }

    // Straight
    if (straight) {
        return { rule: "straight", strength: 5 };
    }

    // Three of a kind
    if (frequencies[0] === 3) {
        return { rule: "three_kind", strength: 6 };
    }

    // Two pair
    if (frequencies[0] === 2 && frequencies[1] === 2) {
        return { rule: "two_pair", strength: 7 };
    }

    // One pair
    if (frequencies[0] === 2) {
        return { rule: "pair", strength: 8 };
    }

    // High card
    return { rule: "high_card", strength: 9 };
}

function sort_cards(hand, house) {
    const cards = [...hand, ...house]
    cards.sort((a,b) => a.value - b.value)

    return cards;
}

function is_flush(hand, house) {
    const cards = [...hand, ...house];
    const suits = {};

    for (const card of cards) {
        suits[card.suit] = (suits[card.suit] || 0) + 1;
        if (suits[card.suit] >= 5) return true;
    }

    return false;
}

function is_straight(hand, house) {
    const cards = sort_cards(hand, house);
    let values = cards.map(card => card.value);

    values = [...new Set(values)];

    values.sort((a, b) => a - b);

    if (values.includes(14)) {
        values.unshift(1);
    }

    let consecutive = 1;

    for (let i = 1; i < values.length; i++) {
        if (values[i] === values[i - 1] + 1) {
            consecutive++;
            if (consecutive >= 5) return true;
        } else {
            consecutive = 1;
        }
    }

    return false;
}
