import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { governmentSchemes, hospitalNetworks, hospitals, insurers, organizations } from "@/db/schema";
import { DEMO } from "./ids";

const TAG = " (DEMO DATA)";

/**
 * More fictional hospitals, one extra insurer, government schemes and network /
 * empanelment rows. Scheme names are real programmes, but every rule and status
 * here is DEMO DATA, not official scheme information.
 */
export async function seedNetwork(db: DbOrTx) {
  const extraHospitals = [
    { id: DEMO.org.hospitalC, name: "Coastal Heart & Kidney Institute", city: "Chennai", state: "Tamil Nadu", departments: ["Cardiology", "Nephrology", "Cardiothoracic Surgery"] },
    { id: DEMO.org.hospitalD, name: "Deccan Community Hospital", city: "Pune", state: "Maharashtra", departments: ["General Medicine", "Paediatrics", "Obstetrics"] },
    { id: DEMO.org.hospitalE, name: "Ganga Valley Medical Centre", city: "Lucknow", state: "Uttar Pradesh", departments: ["Orthopaedics", "Ophthalmology", "General Surgery"] },
  ];
  await db
    .insert(organizations)
    .values([
      ...extraHospitals.map((h) => ({ id: h.id, type: "hospital" as const, name: h.name + TAG, isDemo: true })),
      { id: DEMO.org.insurerC, type: "insurer" as const, name: "Navjeevan General Insurance" + TAG, isDemo: true },
    ])
    .onConflictDoUpdate({ target: organizations.id, set: { name: sql`excluded.name` } });
  await db
    .insert(hospitals)
    .values(extraHospitals.map((h, i) => ({ id: h.id, city: h.city, state: h.state, departments: h.departments, registrationNo: `DEMO-HOSP-00${i + 3}` })))
    .onConflictDoNothing();
  await db.insert(insurers).values({ id: DEMO.org.insurerC, code: "DEMO-NGI", claimsPhone: "1800-000-0003" }).onConflictDoNothing();

  await db
    .insert(governmentSchemes)
    .values([
      {
        id: DEMO.scheme.pmjay,
        code: "PMJAY",
        name: "PM-JAY / Ayushman Bharat",
        authority: "National Health Authority, Government of India",
        description: "Government health assurance for eligible families at empanelled hospitals. Rules in this system are DEMO DATA — always verify with the scheme.",
        isDemo: true,
      },
      {
        id: DEMO.scheme.cghs,
        code: "CGHS",
        name: "Central Government Health Scheme (CGHS)",
        authority: "Ministry of Health & Family Welfare, Government of India",
        description: "Health scheme for eligible central government employees, pensioners and dependants. Rules in this system are DEMO DATA.",
        isDemo: true,
      },
      {
        id: DEMO.scheme.state,
        code: "DEMO-STATE",
        name: "Demo State Health Scheme",
        authority: "Fictional State Health Department (DEMO DATA)",
        description: "A fictional state scheme used to demonstrate state-specific rules.",
        isDemo: true,
      },
    ])
    .onConflictDoNothing();

  const v = (hospitalId: string, payer: { insurerId?: string; tpaId?: string; schemeId?: string }, status: "network" | "non_network" | "empanelled" | "suspended" | "unverified", cashless: boolean) => ({
    hospitalId,
    ...payer,
    status,
    cashlessAvailable: cashless,
    lastVerifiedAt: new Date("2026-09-01T10:00:00+05:30"),
  });
  const rows = [
    v(DEMO.org.hospitalA, { insurerId: DEMO.org.insurerA }, "network", true),
    v(DEMO.org.hospitalA, { insurerId: DEMO.org.insurerB }, "non_network", false),
    v(DEMO.org.hospitalA, { tpaId: DEMO.org.tpaA }, "network", true),
    v(DEMO.org.hospitalA, { schemeId: DEMO.scheme.pmjay }, "empanelled", true),
    v(DEMO.org.hospitalB, { insurerId: DEMO.org.insurerB }, "network", true),
    v(DEMO.org.hospitalB, { insurerId: DEMO.org.insurerA }, "unverified", false),
    v(DEMO.org.hospitalB, { schemeId: DEMO.scheme.cghs }, "empanelled", true),
    v(DEMO.org.hospitalC, { insurerId: DEMO.org.insurerA }, "network", true),
    v(DEMO.org.hospitalC, { insurerId: DEMO.org.insurerC }, "network", true),
    v(DEMO.org.hospitalC, { tpaId: DEMO.org.tpaB }, "network", true),
    v(DEMO.org.hospitalD, { insurerId: DEMO.org.insurerB }, "suspended", false),
    v(DEMO.org.hospitalD, { schemeId: DEMO.scheme.pmjay }, "empanelled", true),
    v(DEMO.org.hospitalD, { schemeId: DEMO.scheme.state }, "empanelled", true),
    v(DEMO.org.hospitalE, { insurerId: DEMO.org.insurerC }, "network", false),
    v(DEMO.org.hospitalE, { schemeId: DEMO.scheme.pmjay }, "empanelled", true),
  ];
  for (const r of rows) {
    // Partial unique indexes can't be targeted by ON CONFLICT column lists, so ignore any conflict.
    await db.insert(hospitalNetworks).values(r).onConflictDoNothing();
  }
}
