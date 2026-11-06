import { redirect } from "next/navigation";
import { authorized, ApiError } from "@/lib/auth";
import { PasswordForm } from "@/components/password-forms";
import { RecoveryMfa } from "@/components/recovery-mfa";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    await authorized();
  } catch (error) {
    if (error instanceof ApiError && error.code === "MFA_REQUIRED")
      return <RecoveryMfa />;
    redirect("/forgot-password");
  }
  return (
    <main className="auth-utility">
      <PasswordForm recovery />
    </main>
  );
}
