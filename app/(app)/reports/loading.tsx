import { LoadingState, PageHeader } from "@/components/ui/Surface";

/** Shown while the report figures for the chosen date range are calculated. */
export default function ReportsLoading() {
  return (
    <>
      <PageHeader title="Reports" />
      <LoadingState label="Loading reports…" />
    </>
  );
}
