// Keyword substitution: the one cipher a viewer can watch being broken.
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function cipherAlphabet(keyword: string) {
  return [...new Set(keyword.toUpperCase() + ABC)].filter(c => ABC.includes(c)).join('')
}

export function encrypt(plain: string, keyword: string) {
  const alpha = cipherAlphabet(keyword)
  return plain.toUpperCase().replace(/[A-Z]/g, c => alpha[ABC.indexOf(c)])
}

// What a captor sees: known letters decoded, the rest blank.
export function partial(cipher: string, known: Map<string, string>) {
  return cipher.replace(/[A-Z]/g, c => known.get(c) ?? '_')
}

export function share(cipher: string, known: Map<string, string>) {
  const letters = cipher.replace(/[^A-Z]/g, '')
  return letters ? [...letters].filter(c => known.has(c)).length / letters.length : 1
}

// Frequency analysis: reveal the n most common still-unknown cipher letters across everything captured.
export function reveal(ciphers: string[], known: Map<string, string>, keyword: string, n: number) {
  const alpha = cipherAlphabet(keyword), freq = new Map<string, number>()
  for (const c of ciphers.join('').replace(/[^A-Z]/g, '')) if (!known.has(c)) freq.set(c, (freq.get(c) ?? 0) + 1)
  const order = [...freq].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  for (const [c] of order.slice(0, n)) known.set(c, ABC[alpha.indexOf(c)])
}
