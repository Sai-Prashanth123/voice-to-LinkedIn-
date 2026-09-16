import { redirect } from "next/navigation";

/**
 * The desk opens on the drafts.
 *
 * This page was "This week" — the weekly pass, where drafts were reviewed, edited, approved and
 * scheduled, and where the conversation question was asked. All of that moved: drafts are written and
 * rewritten in Claude, and reviewed in Telegram. What is left for the desk is looking, and the most
 * useful thing to look at first is what has been written.
 */
export default function Home() {
  redirect("/drafts");
}
