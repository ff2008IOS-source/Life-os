import { redirect } from "next/navigation";
import { authorized, ApiError } from "@/lib/auth";
import { CanvasMaterials } from "@/components/canvas-materials";
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
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 24 }}>
      <CanvasMaterials />
    </main>
  );
}
