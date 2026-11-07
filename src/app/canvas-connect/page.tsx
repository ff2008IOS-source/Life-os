import { redirect } from "next/navigation";
import { authorized, ApiError } from "@/lib/auth";
import { CanvasPanel } from "@/components/canvas-panel";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    await authorized();
  } catch (e) {
    if (e instanceof ApiError && [401, 403].includes(e.status))
      redirect("/login");
    throw e;
  }
  return (
    <main
      className="container"
      style={{ maxWidth: 800, margin: "32px auto", padding: 24 }}
    >
      <CanvasPanel />
    </main>
  );
}
