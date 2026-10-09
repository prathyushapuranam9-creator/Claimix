import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatINR } from "@/lib/india";
import { param, parseListQuery } from "@/lib/pagination";
import { can } from "@/lib/permissions/principal";
import { todayIso } from "@/lib/validation";
import { departmentLabel } from "@/modules/patients/patients.validation";
import { RegistrationService } from "@/modules/scheduling/scheduling.service";
import { PAYMENT_METHOD_LABEL, VISIT_TYPE_LABEL, type PaymentMethod, type VisitType } from "@/modules/scheduling/scheduling.validation";
import { DischargeButton } from "@/components/patients/DischargeButton";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CellLink, CellText, DataTable, Pagination } from "@/components/ui/DataTable";
import { Badge, Card, EmptyState, PageHeader, Stack } from "@/components/ui/Surface";
import styles from "./appointments.module.css";
import { dischargeAction } from "../patients/registration-actions";

export const metadata: Metadata = { title: "Appointments · Claimix" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const PAYMENT = { paid: "paid", pending: "pending" } as const;

/** The front desk's day sheet: what is registered for a date, and who is currently admitted. */
export default async function AppointmentsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext("patient:read");
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const date = param(sp, "date") === "today" || !param(sp, "date") ? todayIso() : param(sp, "date")!;
  const payment = PAYMENT[param(sp, "payment") as keyof typeof PAYMENT];
  const view = param(sp, "view") === "admitted" ? "admitted" : "day";
  const canWrite = can(ctx.principal, "patient:write");

  const [page, admitted] = await Promise.all([
    view === "day" ? RegistrationService.list(ctx, q, { slotDate: date, paymentState: payment }) : Promise.resolve({ rows: [], total: 0 }),
    RegistrationService.currentAdmissions(ctx),
  ]);

  const link = (label: string, href: string, active: boolean) => (
    <ButtonLink key={label} size="sm" variant={active ? "primary" : "secondary"} href={href}>{label}</ButtonLink>
  );

  return (
    <>
      <PageHeader
        title="Appointments"
        description={view === "admitted" ? "Patients currently admitted at your hospital." : `Registered for ${formatDate(date)}.`}
        actions={canWrite && <ButtonLink href="/patients/new">Register patient</ButtonLink>}
      />
      <Stack>
        <Card>
          <div className={styles.filters}>
            {link("Day sheet", `/appointments?date=${date}`, view === "day" && !payment)}
            {link("To collect", `/appointments?date=${date}&payment=pending`, view === "day" && payment === "pending")}
            {link("Collected", `/appointments?date=${date}&payment=paid`, view === "day" && payment === "paid")}
            {link(`In hospital (${admitted.length})`, "/appointments?view=admitted", view === "admitted")}
          </div>
          {/* A plain GET form, so changing the date works without JavaScript. */}
          <form method="get" action="/appointments" className={styles.dateForm}>
            <div>
              <label htmlFor="date" className={styles.dateLabel}>Date</label>
              <input id="date" name="date" type="date" defaultValue={date} className={styles.dateInput} />
            </div>
            {payment && <input type="hidden" name="payment" value={payment} />}
            <Button type="submit" variant="secondary">Show</Button>
          </form>
        </Card>

        {view === "admitted" ? (
          <Card title={`In hospital now (${admitted.length})`} padded={false}>
            <DataTable
              caption="Current admissions"
              rows={admitted}
              rowKey={(a) => a.id}
              empty={<EmptyState title="No patients are admitted right now" />}
              columns={[
                { key: "p", header: "Patient", cell: (a) => <CellLink href={`/patients/${a.patientId}`} sub={<span className="mono">{a.patientNo}</span>}>{a.patientName}</CellLink> },
                { key: "w", header: "Ward / bed", nowrap: true, cell: (a) => <CellText sub={a.bed ? `Bed ${a.bed}` : undefined}>{a.ward ?? "—"}</CellText> },
                { key: "d", header: "Doctor", cell: (a) => a.doctorName },
                { key: "a", header: "Admitted", nowrap: true, cell: (a) => <CellText sub={a.expectedStayDays ? `${a.expectedStayDays} days expected` : undefined}>{formatDateTime(a.admittedAt)}</CellText> },
                ...(canWrite ? [{ key: "x", header: "", cell: (a: (typeof admitted)[number]) => <DischargeButton action={dischargeAction.bind(null, a.id)} patientName={a.patientName} /> }] : []),
              ]}
            />
          </Card>
        ) : (
          <Card title={`Day sheet · ${formatDate(date)}`} padded={false}>
            <DataTable
              caption="Appointments"
              rows={page.rows}
              rowKey={(a) => a.id}
              empty={<EmptyState title="Nothing registered for this date">{canWrite ? "Register a patient to fill the day sheet." : undefined}</EmptyState>}
              columns={[
                { key: "t", header: "Time", nowrap: true, cell: (a) => <CellText sub={a.endsAt.slice(0, 5)}>{a.startsAt.slice(0, 5)}</CellText> },
                { key: "p", header: "Patient", cell: (a) => <CellLink href={`/patients/${a.patientId}`} sub={<span className="mono">{a.patientNo}</span>}>{a.patientName}</CellLink> },
                { key: "d", header: "Doctor", cell: (a) => <CellText sub={departmentLabel(a.department)}>{a.doctorName}</CellText> },
                { key: "v", header: "Visit", cell: (a) => <CellText sub={<span className="mono">{a.reference}</span>}>{VISIT_TYPE_LABEL[a.visitType as VisitType] ?? a.visitType}</CellText> },
                {
                  key: "m",
                  header: "Payment",
                  align: "right",
                  cell: (a) =>
                    a.paymentState === "paid" ? (
                      <CellText sub={a.paymentMethod ? PAYMENT_METHOD_LABEL[a.paymentMethod as PaymentMethod] : "Nothing to collect"}>{formatINR(a.amountCollected)}</CellText>
                    ) : (
                      <CellText sub={`of ${formatINR(a.consultationFee)}`}><Badge tone="warning">To collect</Badge></CellText>
                    ),
                },
                { key: "b", header: "Registered by", cell: (a) => a.registeredBy ?? "—" },
              ]}
            />
            {page.total > 0 && <Pagination basePath="/appointments" params={{ date, payment }} page={q.page} pageSize={q.pageSize} total={page.total} />}
          </Card>
        )}
        <p>
          <Link href="/patients">Find a patient</Link>
        </p>
      </Stack>
    </>
  );
}
