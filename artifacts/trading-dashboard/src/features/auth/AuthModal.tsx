import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { login, register } from "@/core/auth/auth.service";

interface AuthModalProps {
  onClose: () => void;
}

export function AuthModal({ onClose }: AuthModalProps) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError("");

    try {
      if (tab === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      // login() / register() call setUser() internally — both tokens stored
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.75)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.93, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.93, opacity: 0 }}
          transition={{ type: "spring", duration: 0.25 }}
          className="relative flex flex-col gap-4 rounded-lg p-6 font-mono"
          style={{
            background: "#141720",
            border: "1px solid #2B3139",
            width: 340,
            boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold" style={{ color: "#FCD535" }}>
              ALGO_TERMINAL
            </span>
            <span className="text-[10px] text-muted-foreground">Account</span>
          </div>

          <div className="flex gap-1 p-[2px] rounded" style={{ background: "#0B0E11" }}>
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(""); }}
                className="flex-1 py-1 text-xs rounded transition-colors"
                style={{
                  background: tab === t ? "#2B3139" : "transparent",
                  color: tab === t ? "#E8E8E8" : "#848E9C",
                }}
              >
                {t === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Email</label>
              <Input
                type="email"
                placeholder="trader@algo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 text-sm font-mono bg-background/40 border-border/60"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 text-sm font-mono bg-background/40 border-border/60"
              />
            </div>

            {error && (
              <p className="text-[11px] text-center" style={{ color: "#F6465D" }}>
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || !email || !password}
              className="h-9 text-xs font-mono font-bold border-0 mt-1"
              style={{ background: "#FCD535", color: "#0B0E11" }}
            >
              {loading ? "…" : tab === "login" ? "Sign In" : "Create Account"}
            </Button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
