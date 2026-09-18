import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";
import { PublicOnly, RequireAuth } from "@/auth/guards";
import { getCsrfToken } from "@/api/client";
import { LoginPage } from "@/pages/auth/LoginPage";
import { SignupPage } from "@/pages/auth/SignupPage";
import { err, LocationProbe, mockApi, renderApp, SESSION } from "./utils";

function Routes_() {
  return (
    <>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/overview" element={<h1>Overview page</h1>} />
          <Route path="/investigation/:transactionId" element={<h1>Case page</h1>} />
        </Route>
        <Route path="/" element={<h1>Home</h1>} />
      </Routes>
      <LocationProbe />
    </>
  );
}

const loc = () => screen.getByTestId("location").textContent;

describe("route protection and session restore", () => {
  it("waits for /auth/me before showing anything, then redirects signed-out visitors to login with a return destination", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi({ "GET /auth/me": async () => { await gate; return err(401, "UNAUTHENTICATED", "Sign in to continue."); } });
    renderApp(<Routes_ />, { route: "/investigation/TXN-000123" });
    expect(screen.getByText(/restoring your session/i)).toBeInTheDocument();
    expect(screen.queryByText("Case page")).not.toBeInTheDocument();
    release();
    await screen.findByRole("heading", { name: "Log in" });
    expect(loc()).toBe("/login?next=%2Finvestigation%2FTXN-000123");
  });

  it("restores an existing session (refresh on a nested route) and stores the CSRF token in memory only", async () => {
    mockApi({ "GET /auth/me": () => ({ body: SESSION }) });
    renderApp(<Routes_ />, { route: "/investigation/TXN-000123" });
    expect(await screen.findByText("Case page")).toBeInTheDocument();
    expect(getCsrfToken()).toBe("csrf-abc");
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/csrf|password|session/i);
    expect(document.cookie).not.toMatch(/session/i);
  });

  it("sends signed-in visitors away from /login to their validated destination", async () => {
    mockApi({ "GET /auth/me": () => ({ body: SESSION }) });
    renderApp(<Routes_ />, { route: "/login?next=%2Finvestigation%2FTXN-000009" });
    await screen.findByText("Case page");
    expect(loc()).toBe("/investigation/TXN-000009");
  });

  it("ignores an unsafe next parameter", async () => {
    mockApi({ "GET /auth/me": () => ({ body: SESSION }) });
    renderApp(<Routes_ />, { route: "/login?next=%2F%2Fevil.example%2Fx" });
    await screen.findByText("Overview page");
    expect(loc()).toBe("/overview");
  });

  it("shows a retryable error, not the login page, when the backend is unreachable", async () => {
    const api = mockApi({ "GET /auth/me": () => { throw new TypeError("Failed to fetch"); } });
    renderApp(<Routes_ />, { route: "/overview" });
    expect(await screen.findByText(/can't reach the finexa backend/i)).toBeInTheDocument();
    expect(loc()).toBe("/overview");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(api.count("GET /auth/me")).toBe(1);
  });

  it("treats a 401 SESSION_EXPIRED on restore as signed out and tells the user on the login page", async () => {
    mockApi({ "GET /auth/me": () => err(401, "SESSION_EXPIRED", "Your session has expired.") });
    renderApp(<Routes_ />, { route: "/overview" });
    await screen.findByRole("heading", { name: "Log in" });
    expect(screen.getByText(/your session expired/i)).toBeInTheDocument();
  });
});

describe("login form", () => {
  it("validates inline and does not call the API for empty input", async () => {
    const api = mockApi({ "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"), "POST /auth/login": () => ({ body: SESSION }) });
    renderApp(<Routes_ />, { route: "/login" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(api.count("POST /auth/login")).toBe(0);
  });

  it("uses correct autocomplete attributes, labels and a password visibility toggle", async () => {
    mockApi({ "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x") });
    renderApp(<Routes_ />, { route: "/login" });
    const email = await screen.findByLabelText("Email");
    const pw = screen.getByLabelText("Password");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(pw).toHaveAttribute("autocomplete", "current-password");
    expect(pw).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pw).toHaveAttribute("type", "text");
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute("href", "/signup");
    expect(screen.queryByText(/forgot|google|github|facebook/i)).not.toBeInTheDocument();
  });

  it("shows a helpful message for invalid credentials and re-enables the form", async () => {
    mockApi({
      "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"),
      "POST /auth/login": () => err(401, "INVALID_CREDENTIALS", "Incorrect email or password."),
    });
    renderApp(<Routes_ />, { route: "/login" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password-1");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect email or password/i);
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
    expect(loc()).toBe("/login");
  });

  it("blocks duplicate submissions and lands on the return destination after success", async () => {
    let n = 0;
    const api = mockApi({
      "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"),
      "POST /auth/login": async () => { n++; await new Promise((r) => setTimeout(r, 50)); return { body: SESSION }; },
    });
    renderApp(<Routes_ />, { route: "/login?next=%2Finvestigation%2FTXN-000123" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    const submit = screen.getByRole("button", { name: "Log in" });
    await user.dblClick(submit);
    await screen.findByText("Case page");
    expect(n).toBe(1);
    expect(api.calls.find((c) => c.url.pathname.endsWith("/auth/login"))?.body).toEqual({ email: "ana@example.com", password: "correct horse 42" });
    expect(getCsrfToken()).toBe("csrf-abc");
    expect(loc()).toBe("/investigation/TXN-000123");
  });

  it("surfaces the lockout message from the server", async () => {
    mockApi({
      "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"),
      "POST /auth/login": () => err(429, "TOO_MANY_ATTEMPTS", "Too many failed attempts. Try again in 300 seconds."),
    });
    renderApp(<Routes_ />, { route: "/login" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/300 seconds/);
  });

  it("explains an unreachable backend on submit", async () => {
    mockApi({ "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"), "POST /auth/login": () => { throw new TypeError("Failed to fetch"); } });
    renderApp(<Routes_ />, { route: "/login" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot reach the finexa backend/i);
  });
});

describe("signup form", () => {
  it("shows requirements, validates each rule, and does not submit an invalid form", async () => {
    const api = mockApi({ "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"), "POST /auth/signup": () => ({ status: 201, body: SESSION }) });
    renderApp(<Routes_ />, { route: "/signup" });
    const user = userEvent.setup();
    const list = await screen.findByRole("list", { name: /password requirements/i });
    expect(list).toHaveTextContent("10-128 characters");
    await user.type(screen.getByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "short1");
    await user.type(screen.getByLabelText("Confirm password"), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(/doesn't meet all the requirements/i)).toBeInTheDocument();
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(api.count("POST /auth/signup")).toBe(0);
  });

  it("creates the account, starts a session and redirects", async () => {
    const api = mockApi({ "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"), "POST /auth/signup": () => ({ status: 201, body: SESSION }) });
    renderApp(<Routes_ />, { route: "/signup" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse 42");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByText("Overview page");
    expect(api.calls.find((c) => c.url.pathname.endsWith("/auth/signup"))?.body).toEqual({ email: "ana@example.com", password: "correct horse 42" });
  });

  it("maps a duplicate email to the email field, with a link to log in", async () => {
    mockApi({
      "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"),
      "POST /auth/signup": () => err(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists."),
    });
    renderApp(<Routes_ />, { route: "/signup" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse 42");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeInTheDocument());
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("link", { name: /log in instead/i })).toBeInTheDocument();
  });

  it("shows server-side password validation on the password field", async () => {
    mockApi({
      "GET /auth/me": () => err(401, "UNAUTHENTICATED", "x"),
      "POST /auth/signup": () => err(422, "VALIDATION_ERROR", "Request validation failed.", [{ location: "body.password", message: "Password must include at least one letter and one number." }]),
    });
    renderApp(<Routes_ />, { route: "/signup" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse 42");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(/at least one letter and one number\./)).toBeInTheDocument();
  });
});
