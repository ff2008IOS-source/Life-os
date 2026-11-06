import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <h1>This page isn’t here</h1>
      <p className="muted">Return to your daily command center.</p>
      <Link href="/">Go Home →</Link>
    </main>
  );
}
