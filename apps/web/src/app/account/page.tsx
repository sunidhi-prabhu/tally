import type { Metadata } from "next";
import { AccountScreen } from "@/screens/AccountScreen";

export const metadata: Metadata = { title: "Account · Tally" };

export default function AccountPage() {
  return <AccountScreen />;
}
