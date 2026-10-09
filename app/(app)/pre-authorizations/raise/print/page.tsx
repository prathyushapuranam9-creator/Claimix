import { redirect } from "next/navigation";
import { param } from "@/lib/pagination";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** The old print template now lives on the Register Case page (print, download PDF, save, sign, submit). */
export default async function PrintTemplatePage({ searchParams }: { searchParams: SP }) {
  const id = param(await searchParams, "id");
  redirect(id ? `/pre-authorizations/raise/register?id=${encodeURIComponent(id)}` : "/pre-authorizations/raise");
}
