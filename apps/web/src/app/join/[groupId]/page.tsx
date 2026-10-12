import { GroupRoute } from "@/components/GroupRoute";
import { JoinGroup } from "@/screens/JoinGroup";

export default function JoinPage({ params }: PageProps<"/join/[groupId]">) {
  return <GroupRoute params={params} Screen={JoinGroup} />;
}
