import type { Metadata } from "next";
import { CreateGroup } from "@/screens/CreateGroup";

export const metadata: Metadata = { title: "New group · Tally" };

export default function NewGroupPage() {
  return <CreateGroup />;
}
