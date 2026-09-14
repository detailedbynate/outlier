/** Root loading state stays neutral: "/" is either the landing page or the dashboard. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <div className="route-progress" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
