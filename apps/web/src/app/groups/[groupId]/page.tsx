import { GroupRoute } from "@/components/GroupRoute";
import { GroupDetail } from "@/screens/GroupDetail";

export default function GroupPage({ params }: PageProps<"/groups/[groupId]">) {
  return <GroupRoute params={params} Screen={GroupDetail} />;
}
