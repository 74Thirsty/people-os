import Link from "next/link";
import LoginForm from "./login-form";

export default function LoginPage() {
  return <main className="auth-shell">
    <section className="auth-card">
      <Link className="brand" href="/"><span className="mark">P</span>PeopleOS</Link>
      <div className="eyebrow">Secure employer access</div>
      <h1>Sign in to PeopleOS.</h1>
      <p className="lead">Use your work email. We’ll send a one-time sign-in link.</p>
      <LoginForm />
    </section>
  </main>;
}
