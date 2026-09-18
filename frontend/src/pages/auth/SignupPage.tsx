import { useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Circle } from "lucide-react";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { EMAIL_RE, checkPassword } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { AuthLayout, FormAlert, PasswordInput } from "./AuthLayout";

export function SignupPage() {
  const { signup } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false, confirm: false });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const inFlight = useRef(false);

  const checks = checkPassword(password, email);
  const emailError = !email.trim() ? "Enter your email address." : !EMAIL_RE.test(email.trim()) ? "Enter a valid email address." : null;
  const passwordError = !password ? "Create a password." : checks.some((c) => !c.ok) ? "Your password doesn't meet all the requirements below." : null;
  const confirmError = !confirm ? "Re-enter your password." : confirm !== password ? "Passwords don't match." : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setTouched({ email: true, password: true, confirm: true });
    setServerError(null);
    setFieldErrors({});
    if (emailError || passwordError || confirmError) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await signup(email.trim(), password);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "EMAIL_ALREADY_REGISTERED") setFieldErrors({ email: "An account with this email already exists." });
        else if (err.code === "VALIDATION_ERROR" && (err.fieldMessage("email") || err.fieldMessage("password"))) {
          setFieldErrors({ email: err.fieldMessage("email"), password: err.fieldMessage("password") });
        } else setServerError(err.message);
      } else setServerError("Something went wrong. Please try again.");
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const emailShown = fieldErrors.email ?? (touched.email ? emailError : null);
  const passwordShown = fieldErrors.password ?? (touched.password ? passwordError : null);

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start exploring fraud risk in a historical simulation workspace."
      footer={<>Already have an account? <Link to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-primary hover:underline">Log in</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {serverError && <FormAlert>{serverError}</FormAlert>}
        <Field
          id="email" label="Email" error={emailShown}
        >
          <Input
            id="email" name="email" type="email" inputMode="email" autoComplete="email" autoFocus
            value={email} onChange={(e) => { setEmail(e.target.value); setFieldErrors((f) => ({ ...f, email: undefined })); }}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={!!emailShown} aria-describedby={emailShown ? "email-error" : undefined} disabled={submitting}
          />
          {fieldErrors.email && (
            <p className="text-xs text-muted-foreground">Already registered? <Link to="/login" className="font-medium text-primary hover:underline">Log in instead</Link>.</p>
          )}
        </Field>

        <Field id="password" label="Password" error={passwordShown}>
          <PasswordInput
            id="password" value={password} autoComplete="new-password" disabled={submitting}
            onChange={(v) => { setPassword(v); setFieldErrors((f) => ({ ...f, password: undefined })); }}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            invalid={!!passwordShown} describedBy={cn(passwordShown && "password-error", "password-rules")}
          />
          <ul id="password-rules" className="mt-2 space-y-1 text-xs" aria-label="Password requirements">
            {checks.map((c) => (
              <li key={c.id} className={cn("flex items-center gap-1.5", c.ok ? "text-success" : "text-muted-foreground")}>
                {c.ok ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
                <span>{c.label}</span>
                <span className="sr-only">{c.ok ? "(met)" : "(not met yet)"}</span>
              </li>
            ))}
          </ul>
        </Field>

        <Field id="confirm" label="Confirm password" error={touched.confirm ? confirmError : null}>
          <PasswordInput
            id="confirm" value={confirm} onChange={setConfirm} onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
            autoComplete="new-password" invalid={touched.confirm && !!confirmError}
            describedBy={touched.confirm && confirmError ? "confirm-error" : undefined} disabled={submitting}
          />
        </Field>

        <Button type="submit" className="w-full" size="lg" loading={submitting}>{submitting ? "Creating account…" : "Create account"}</Button>
      </form>
    </AuthLayout>
  );
}
