import { GroupRoute } from "@/components/GroupRoute";
import { Members } from "@/screens/Members";

export default function MembersPage({
  params,
}: PageProps<"/groups/[groupId]/members">) {
  return <GroupRoute params={params} Screen={Members} />;
}
