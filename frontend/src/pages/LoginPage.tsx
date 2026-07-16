import { FormEvent, useState } from "react";

import { ApiError } from "../api/client";
import { BrandMark } from "../components/BrandMark";
import { useAuth } from "../state/auth";

export function LoginPage() {
  const { signIn, previewAsCashier } = useAuth();
  const [username, setUsername] = useState("admin1");
  const [password, setPassword] = useState("DemoPass123!");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Could not reach the backend. Is uvicorn running?";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <BrandMark />
        <div className="login-hero__copy">
          <p className="eyebrow">Retail system</p>
          <h1>Sales, stock, repairs, and reports in one workspace.</h1>
          <p>
            Built for a practical electronics shop workflow: cashier desk,
            repair bench, purchasing, inventory, and branch operations.
          </p>
        </div>
        <div className="crystal-card">
          <span>Today sales</span>
          <strong>KES 82,400</strong>
          <small>Main Branch</small>
        </div>
      </section>

      <section className="login-panel" aria-label="Sign in">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in</h2>
          <p className="muted">
            Use seeded credentials after running the backend seed, or preview the
            interface without connecting to the API.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={loading}>
            {loading ? "Opening..." : "Open workspace"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={previewAsCashier}
          >
            Preview as Cashier 1
          </button>
        </form>
      </section>
    </main>
  );
}
