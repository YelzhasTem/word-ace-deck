import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { AuthError, Session } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function getAuthErrorMessage(err: unknown) {
  const authError = err as Partial<AuthError> & { status?: number };
  const msg = String(authError?.message ?? "");
  const lowerMsg = msg.toLowerCase();

  console.error("[Auth]", {
    code: authError?.code,
    status: authError?.status,
    message: msg,
  });

  if (authError?.status === 429 || lowerMsg.includes("too many requests")) {
    return "Too many attempts. Wait a few minutes and try again.";
  }

  if (authError?.code === "weak_password" || lowerMsg.includes("weak")) {
    return "The password is too weak. Use a stronger password.";
  }

  if (authError?.code === "invalid_credentials" || lowerMsg.includes("invalid login")) {
    return "Invalid email or password. Check your details or create an account.";
  }

  if (lowerMsg.includes("email logins are disabled")) {
    return "Email login is disabled in Supabase. Enable the Email provider in Authentication -> Providers.";
  }

  if (authError?.code === "user_already_exists" || lowerMsg.includes("already")) {
    return "This email is already registered. Try signing in.";
  }

  if (authError?.code === "email_not_confirmed" || lowerMsg.includes("not confirmed")) {
    return "Email is not confirmed yet. Check your inbox and open the confirmation link.";
  }

  if (authError?.status === 400) {
    return "Supabase rejected the request. Check your details and Auth provider settings.";
  }

  return msg || "Could not complete the action. Check your Supabase Auth settings.";
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error("Enter an email address.");
      return;
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: {
              display_name: displayName.trim() || normalizedEmail.split("@")[0],
            },
          },
        });

        if (error) throw error;

        if (data.session) {
          toast.success("Account created.");
          await navigate({ to: "/dashboard" });
        } else {
          toast.success("Account created. Check your email to confirm it.");
          setMode("login");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) throw error;

        toast.success("You are signed in.");
        await navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (error) {
      setGoogleLoading(false);
      toast.error(getAuthErrorMessage(error));
    }
  };

  const handleReset = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error("Enter an email address.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) toast.error(getAuthErrorMessage(error));
    else toast.success("Reset link sent to your email.");
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(getAuthErrorMessage(error));
      return;
    }
    setSession(null);
    toast.success("You are signed out.");
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-4"
      style={{
        backgroundImage: "url('/auth-background.png')",
        backgroundPosition: "center",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="absolute inset-0 bg-slate-950/70" />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card/95 p-8 shadow-sm backdrop-blur-xl">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back home
        </Link>

        {session ? (
          <div className="mt-6 space-y-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">You are already signed in</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Account: <span className="font-medium text-foreground">{session.user.email}</span>
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button" onClick={() => navigate({ to: "/dashboard" })}>
                Open app
              </Button>
              <Button type="button" variant="outline" onClick={handleLogout}>
                Sign out
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="mt-4 text-2xl font-bold tracking-tight">
              {mode === "login" ? "Sign in" : "Sign up"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "login"
                ? "Sign in with email and password or Google."
                : "Create an account to save your progress."}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading || googleLoading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "login" ? "Sign in" : "Sign up"}
              </Button>
            </form>

            <div className="mt-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-4 w-full"
              onClick={handleGoogleLogin}
              disabled={loading || googleLoading}
            >
              {googleLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.12c-.22-.66-.35-1.36-.35-2.12s.13-1.46.35-2.12V7.04H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.96l3.66-2.84z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
                  />
                </svg>
              )}
              Continue with Google
            </Button>

            <div className="mt-4 flex justify-between text-sm">
              <button
                type="button"
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                className="text-primary hover:underline"
              >
                {mode === "login" ? "Create account" : "Already have an account?"}
              </button>

              {mode === "login" && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Forgot password?
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
