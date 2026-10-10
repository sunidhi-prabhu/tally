import { GroupRoute } from "@/components/GroupRoute";
import { Settle } from "@/screens/Settle";

export default function SettlePage({
  params,
}: PageProps<"/groups/[groupId]/settle">) {
  return <GroupRoute params={params} Screen={Settle} />;
}
