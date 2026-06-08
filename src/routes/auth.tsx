import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { display_name: displayName || normalizedEmail.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Аккаунт создан! Проверьте почту для подтверждения.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        toast.success("Добро пожаловать!");
        navigate({ to: "/dashboard" });
      }
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      let humanMsg = msg;
      if (err?.code === "weak_password" || msg.toLowerCase().includes("weak")) {
        humanMsg = "Пароль слишком простой или скомпрометирован. Используйте более надёжный пароль (буквы, цифры и символы).";
      } else if (err?.code === "invalid_credentials" || msg.toLowerCase().includes("invalid login")) {
        humanMsg = "Неверный email или пароль. Если у вас ещё нет аккаунта — зарегистрируйтесь.";
      } else if (msg.toLowerCase().includes("email logins are disabled")) {
        humanMsg = "Вход по email отключён в Supabase. Включите Email provider в Supabase Auth.";
      } else if (err?.code === "user_already_exists" || msg.toLowerCase().includes("already")) {
        humanMsg = "Этот email уже зарегистрирован. Войдите в аккаунт.";
      } else if (err?.code === "email_not_confirmed" || msg.toLowerCase().includes("not confirmed")) {
        humanMsg = "Подтвердите email — мы отправили вам письмо.";
      }
      toast.error(humanMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return toast.error("Введите email");
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success("Ссылка отправлена на почту");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← На главную</Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">
          {mode === "login" ? "Вход" : "Регистрация"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "login" ? "Войдите в свой аккаунт" : "Создайте аккаунт для сохранения прогресса"}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="name">Имя</Label>
              <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ваше имя" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Минимум 6 символов" />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Загрузка…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </Button>
        </form>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">или</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          onClick={async () => {
            const { error } = await supabase.auth.signInWithOAuth({
              provider: "google",
              options: {
                redirectTo: `${window.location.origin}/dashboard`,
              },
            });
            if (error) toast.error(error.message);
          }}
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.12c-.22-.66-.35-1.36-.35-2.12s.13-1.46.35-2.12V7.04H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.96l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
          </svg>
          Продолжить с Google
        </Button>


        <div className="mt-4 flex justify-between text-sm">
          <button onClick={() => setMode(mode === "login" ? "signup" : "login")} className="text-primary hover:underline">
            {mode === "login" ? "Создать аккаунт" : "Уже есть аккаунт?"}
          </button>
          {mode === "login" && (
            <button onClick={handleReset} className="text-muted-foreground hover:text-foreground">
              Забыли пароль?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
