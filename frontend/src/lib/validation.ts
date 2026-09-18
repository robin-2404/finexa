/** Mirrors the backend rules in app/services/auth.py (docs/frontend-integration.md, section 2). */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export interface PasswordCheck {
  id: string;
  label: string;
  ok: boolean;
}

export function checkPassword(pw: string, email: string): PasswordCheck[] {
  return [
    { id: "length", label: `${PASSWORD_MIN}-${PASSWORD_MAX} characters`, ok: pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX },
    { id: "letter", label: "At least one letter", ok: /[A-Za-z]/.test(pw) },
    { id: "number", label: "At least one number", ok: /\d/.test(pw) },
    { id: "email", label: "Not the same as your email", ok: !pw || pw.toLowerCase() !== email.trim().toLowerCase() },
  ];
}
