import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/crm/auth";

// CRM entry point: staff land on the dashboard, participants on their profile.
export default async function CrmHome() {
  const v = await requireViewer();
  redirect(v.isStaff ? "/dashboard" : "/me");
}
