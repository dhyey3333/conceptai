import { Workspace } from "@/components/learn/Workspace";

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ start?: string }>;
}) {
  const { id } = await params;
  const { start } = await searchParams;
  return <Workspace id={id} autostart={start === "1"} />;
}
