// Brazilian document/format validators + formatters (ticket 23).
// Pure functions, no dependencies — safe to import from client or server code.

/** Strips everything but digits. */
export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

function modulo11CheckDigit(digits: string, weights: number[]): number {
  const sum = digits
    .split("")
    .reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Validates a CNPJ (14 digits) via standard mod-11 check digits. Accepts
 * formatted or raw input. */
export function isValidCNPJ(s: string): boolean {
  const digits = onlyDigits(s);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = modulo11CheckDigit(digits.slice(0, 12), firstWeights);
  if (d1 !== Number(digits[12])) return false;

  const d2 = modulo11CheckDigit(digits.slice(0, 13), secondWeights);
  if (d2 !== Number(digits[13])) return false;

  return true;
}

/** Validates a CPF (11 digits) via standard mod-11 check digits. Accepts
 * formatted or raw input. */
export function isValidCPF(s: string): boolean {
  const digits = onlyDigits(s);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const firstWeights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = modulo11CheckDigit(digits.slice(0, 9), firstWeights);
  if (d1 !== Number(digits[9])) return false;

  const d2 = modulo11CheckDigit(digits.slice(0, 10), secondWeights);
  if (d2 !== Number(digits[10])) return false;

  return true;
}

/** Validates a CEP: exactly 8 digits after stripping formatting. */
export function isValidCEP(s: string): boolean {
  return onlyDigits(s).length === 8;
}

/** Formats a CNPJ as `00.000.000/0000-00`. Assumes 14 digits of input
 * (formatted or raw); returns the stripped digits unchanged otherwise. */
export function formatCNPJ(d: string): string {
  const digits = onlyDigits(d);
  if (digits.length !== 14) return digits;
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}

/** Formats a CPF as `000.000.000-00`. */
export function formatCPF(d: string): string {
  const digits = onlyDigits(d);
  if (digits.length !== 11) return digits;
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

/** Formats a CEP as `00000-000`. */
export function formatCEP(d: string): string {
  const digits = onlyDigits(d);
  if (digits.length !== 8) return digits;
  return digits.replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

/** Simple email shape check — not RFC-exhaustive, good enough for signup
 * forms. */
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
