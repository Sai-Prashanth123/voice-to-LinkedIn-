import { redirect } from "next/navigation";

/**
 * There is no sign-in any more.
 *
 * The page is kept rather than deleted because the address is in circulation: it is in the
 * handbook, in Josh's browser history, and at the end of every magic link already sent. Deleting
 * the route would answer all of those with a 404, which reads as "the desk is gone" rather than
 * "the desk no longer asks who you are".
 *
 * So it forwards. Anyone arriving at an old link lands on the desk itself.
 */
export const dynamic = "force-dynamic";

export default function Login() {
  redirect("/");
}
