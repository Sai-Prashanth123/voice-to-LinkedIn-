/**
 * What Josh sees while a page is fetching.
 *
 * Every route here is server-rendered and reads the database, so a navigation is not instant — and
 * without this file Next.js shows the OLD page until the new one is ready. Clicking a nav link and
 * having nothing happen for a second reads as a broken link, so the second click starts arriving,
 * and the impression is of a slow, unreliable tool.
 *
 * Streamed immediately, before any query runs. It mirrors the real page's shape rather than showing
 * a spinner, so the layout does not jump when the content lands.
 */
export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <section className="step">
        <div className="step-head">
          <span className="step-no">··</span>
          <h2 className="skeleton-title" />
        </div>
        <div className="entry skeleton">
          <div className="skeleton-line short" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
        <div className="entry skeleton">
          <div className="skeleton-line short" />
          <div className="skeleton-line" />
        </div>
      </section>
    </main>
  );
}
