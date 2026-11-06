"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="standalone">
      <h1>We couldn’t open your workspace</h1>
      <p className="muted">
        Your changes may still be saved. Try loading the page again.
      </p>
      <Button onClick={reset}>Try again</Button>
      <Link href="/login">Return to sign in</Link>
    </main>
  );
}
