import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * A magic link, because there is one user and a password is one more thing to lose.
 */
async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (allowed && email !== allowed) redirect("/login?denied=1");

  const db = await supabaseServer();
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback` },
  });
  redirect(error ? "/login?failed=1" : "/login?sent=1");
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; denied?: string; failed?: string }>;
}) {
  const params = await searchParams;

  return (
    <main>
      <section className="step">
        <div className="step-head">
          <span className="step-no">—</span>
          <h2>Sign in</h2>
        </div>

        {params.sent
          ? (
            <div className="quiet">
              <strong>Check your email.</strong>{" "}
              The link signs you straight in and expires shortly.
            </div>
          )
          : (
            <>
              {params.denied && (
                <div className="quiet" style={{ borderColor: "var(--mark)", marginBottom: "1.5rem" }}>
                  That address cannot access this system.
                </div>
              )}
              {params.failed && (
                <div className="quiet" style={{ borderColor: "var(--mark)", marginBottom: "1.5rem" }}>
                  The link could not be sent. Try again in a moment.
                </div>
              )}
              <form action={sendLink} className="row">
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="you@slingshotgtm.com"
                  aria-label="Email address"
                  style={{ minWidth: "18rem" }}
                />
                <button type="submit" className="primary">Send me a link</button>
              </form>
            </>
          )}
      </section>
    </main>
  );
}
