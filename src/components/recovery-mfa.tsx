"use client";
import { useRouter } from "next/navigation";
import { MfaPanel } from "./mfa-panel";
export function RecoveryMfa() {
  const router = useRouter();
  return (
    <main className="auth-utility">
      <MfaPanel challenge onVerified={() => router.refresh()} />
    </main>
  );
}
