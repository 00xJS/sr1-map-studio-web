// Ported from SR1-Creator (github.com/00xJS/SR1-Creator)
// Volition string hash used by Saints Row (2006): CRC-32 (IEEE polynomial, reflected) over the
// lower-cased string, with initial value 0 and no final inversion.
const TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  TABLE[i] = c >>> 0
}

export function volitionHash(str: string): number {
  let h = 0
  const s = str.toLowerCase()
  for (let i = 0; i < s.length; i++) h = TABLE[(h ^ s.charCodeAt(i)) & 0xff] ^ (h >>> 8)
  return h >>> 0
}

export const hex8 = (h: number) => (h >>> 0).toString(16).padStart(8, '0')
