import { notFound } from "next/navigation";
import { JsonPreview } from "./json-preview";

export default function PreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <JsonPreview />;
}
