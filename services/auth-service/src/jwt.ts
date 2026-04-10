import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET ?? "algo_terminal_secret";
const EXPIRY = "7d";

export interface JwtPayload {
  userId: number;
}

export function signToken(userId: number): string {
  return jwt.sign({ userId } satisfies JwtPayload, SECRET, { expiresIn: EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  const payload = jwt.verify(token, SECRET);
  if (typeof payload !== "object" || payload === null || !("userId" in payload)) {
    throw new Error("Invalid token payload");
  }
  return { userId: Number((payload as Record<string, unknown>).userId) };
}
