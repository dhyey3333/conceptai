import { notFound } from "next/navigation";
import { BoardGallery } from "./BoardGallery";

/** Dev-only gallery of board items, for checking how diagrams are drawn. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BoardGallery />;
}
