import { redirect } from "next/navigation";
export default function Page() {
  redirect("/settings?section=integrations&canvas=manage#canvas-connection");
}
