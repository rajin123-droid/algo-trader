/**
 * Password Policy — enforced on register and password-change flows.
 *
 * Rules (production-grade, matches NIST SP 800-63B + OWASP guidance):
 *   • Minimum 8 characters
 *   • At least one uppercase letter (A-Z)
 *   • At least one digit (0-9)
 *   • No leading/trailing whitespace
 *   • Maximum 128 characters (prevents bcrypt truncation edge cases)
 *
 * Returns a descriptive error string or null if the password is acceptable.
 */

export interface PolicyResult {
  ok:     boolean;
  errors: string[];
}

export function validatePassword(password: string): PolicyResult {
  const errors: string[] = [];

  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, errors: ["Password is required"] };
  }

  if (password !== password.trim()) {
    errors.push("Password must not start or end with whitespace");
  }

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters");
  }

  if (password.length > 128) {
    errors.push("Password must not exceed 128 characters");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  return { ok: errors.length === 0, errors };
}
