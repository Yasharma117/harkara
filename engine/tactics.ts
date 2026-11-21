// The War Council's tactic cards: the only thing a visitor sends is a house and three card ids. The API turns them into
// the doctrine text here, so no visitor-written text ever reaches a general's prompt or the published results (only the
// optional name does). Shared by the page (client/ladder.ts), the API (functions/api) and the tests.
// Orders say "ford": that is the word on the generals' own map. Cards in the same group exclude each other.
export const DECK: { id: string; glyph: string; title: string; line: string; order: string; group?: string }[] = [
  { id: 'code', glyph: '✉', title: 'Code every letter', line: 'Slow to send, slow to read', order: 'Send every order in cipher, never plain.', group: 'cipher' },
  { id: 'plain', glyph: '➶', title: 'Speed over secrecy', line: 'Plain letters leave at once', order: 'Send orders plain so they leave at once.', group: 'cipher' },
  { id: 'decoy', glyph: '◇', title: 'Send decoys', line: 'A false letter, meant to be caught', order: 'Before each real attack, send a decoy letter naming a false target, meant to be caught.' },
  { id: 'twin', glyph: '⇉', title: 'Two riders', line: 'Big orders go by two roads', order: 'Send every important order by two riders on two different roads.' },
  { id: 'hunt', glyph: '⚔', title: 'Hunt their riders', line: 'Horse patrols the roads', order: 'Use your horse to catch enemy riders on the roads rather than to fight.' },
  { id: 'read', glyph: '◉', title: 'Act on their mail', line: 'Meet them where they said', order: 'Act on every enemy letter you capture: be where it says they are going, first.' },
  { id: 'west', glyph: '◀', title: 'Take the west crossing', line: 'Early, with everything', order: 'Take the west ford in the first five watches and hold it.', group: 'aim' },
  { id: 'middle', glyph: '◆', title: 'Take the middle crossing', line: 'Early, with everything', order: 'Take the middle ford in the first five watches and hold it.', group: 'aim' },
  { id: 'east', glyph: '▶', title: 'Take the east crossing', line: 'Early, with everything', order: 'Take the east ford in the first five watches and hold it.', group: 'aim' },
  { id: 'hold', glyph: '▣', title: 'Never let go', line: 'What you hold, you keep', order: 'Once you hold a ford, never leave it; defend it with foot and elephants.' },
  { id: 'truce', glyph: '☍', title: 'Make a friend', line: 'A truce, then turn on the rest', order: 'Offer a truce to one rival early, and fight the others.' },
  { id: 'smoke', glyph: '♨', title: 'Last-watch charge', line: 'Smoke, then everything moves', order: 'Save smoke signals for an all-out move in the last three watches.' },
]
export const PICK = 3

// three distinct known cards, at most one per group → the doctrine text (its "Tactics:" line lets results show the cards)
export function compose(ids: unknown): { text: string } | { error: string } {
  if (!Array.isArray(ids) || ids.length !== PICK || new Set(ids).size !== PICK) return { error: `choose ${PICK} different tactics` }
  const cards = ids.map(i => DECK.find(c => c.id === i))
  if (cards.some(c => !c)) return { error: 'unknown tactic' }
  const groups = cards.map(c => c!.group).filter(Boolean)
  if (new Set(groups).size !== groups.length) return { error: 'those tactics contradict each other' }
  return { text: `Tactics: ${cards.map(c => c!.title).join('; ')}. ${cards.map(c => c!.order).join(' ')}` }
}
