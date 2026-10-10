import { GroupRoute } from "@/components/GroupRoute";
import { NewExpense } from "@/screens/NewExpense";

export default function NewExpensePage({
  params,
}: PageProps<"/groups/[groupId]/expenses/new">) {
  return <GroupRoute params={params} Screen={NewExpense} />;
}
