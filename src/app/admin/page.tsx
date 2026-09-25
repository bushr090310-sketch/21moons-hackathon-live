import type { Metadata } from "next";
import { AdminApp } from "./admin-app";

export const metadata: Metadata = { title: "Command" };

export default function Page() {
  return <AdminApp />;
}
