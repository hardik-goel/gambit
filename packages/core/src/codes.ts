/** Room codes: 6 chars, unambiguous alphabet (no O/0, I/1, S/5). */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY2346789";

export function makeRoomCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
}

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "Q")
    .replace(/0/g, "Q")
    .slice(0, 6);
}

export function isValidCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code) && [...code].every((c) => ALPHABET.includes(c));
}
