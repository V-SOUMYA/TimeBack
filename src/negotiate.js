// Buyer agent vs. seller agent. The seller has a hidden floor price that the
// buyer never sees. Numbers are decided here (deterministic and fair);
// the AI layer only writes the chat lines.

const { round2 } = require('./optimizer');

function negotiate(option, maxRounds = 3) {
  const list = option.basePrice;
  const floor = option.floor;
  let ask = list;
  let bid = round2(list * 0.72);
  const rounds = [{ from: 'buyer', type: 'open', price: bid }];

  for (let i = 0; i < maxRounds; i++) {
    if (bid >= floor) {
      rounds.push({ from: 'seller', type: 'accept', price: bid });
      return finish(rounds, bid, list);
    }
    ask = round2(Math.max(floor, ask - (ask - floor) * 0.6));
    rounds.push({ from: 'seller', type: i === maxRounds - 1 ? 'final' : 'counter', price: ask });
    const raise = round2(bid + (ask - bid) * 0.55);
    if (raise >= ask || i === maxRounds - 1) {
      rounds.push({ from: 'buyer', type: 'accept', price: ask });
      return finish(rounds, ask, list);
    }
    bid = raise;
    rounds.push({ from: 'buyer', type: 'raise', price: bid });
  }
  rounds.push({ from: 'buyer', type: 'accept', price: ask });
  return finish(rounds, ask, list);
}

function finish(rounds, price, list) {
  return { rounds, price: round2(price), saved: round2(list - price) };
}

module.exports = { negotiate };
