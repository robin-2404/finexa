import { useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { EMAIL_RE } from "@/lib/validation";
import { AuthLayout, FormAlert, PasswordInput } from "./AuthLayout";

export function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inFlight = useRef(false); // blocks duplicate submissions before React re-renders

  const emailError = !email.trim() ? "Enter your email address." : !EMAIL_RE.test(email.trim()) ? "Enter a valid email address." : null;
  const passwordError = !password ? "Enter your password." : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setTouched({ email: true, password: true });
    setServerError(null);
    if (emailError || passwordError) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // PublicOnly redirects to the validated destination once the session is set.
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(
          err.code === "INVALID_CREDENTIALS" ? "Incorrect email or password. Check them and try again."
          : err.code === "TOO_MANY_ATTEMPTS" ? err.message
          : err.isNetwork ? err.message
          : err.message,
        );
      } else setServerError("Something went wrong. Please try again.");
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back. Sign in to your analyst workspace."
      footer={<>New to FINEXA? <Link to={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-primary hover:underline">Create an account</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-describedby={serverError ? "login-error" : undefined}>
        {sessionExpired && !serverError && <FormAlert tone="info">Your session expired. Please sign in again.</FormAlert>}
        {serverError && <FormAlert id="login-error">{serverError}</FormAlert>}
        <Field id="email" label="Email" error={touched.email ? emailError : null}>
          <Input
            id="email" name="email" type="email" inputMode="email" autoComplete="email" autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={touched.email && !!emailError} aria-describedby={touched.email && emailError ? "email-error" : undefined}
            disabled={submitting}
          />
        </Field>
        <Field id="password" label="Password" error={touched.password ? passwordError : null}>
          <PasswordInput
            id="password" value={password} onChange={setPassword} onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            autoComplete="current-password" invalid={touched.password && !!passwordError}
            describedBy={touched.password && passwordError ? "password-error" : undefined} disabled={submitting}
          />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={submitting}>{submitting ? "Signing in…" : "Log in"}</Button>
      </form>
    </AuthLayout>
  );
}
