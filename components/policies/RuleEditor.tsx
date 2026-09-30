"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ActionResult } from "@/lib/action-result";
import { useServerResult } from "@/lib/use-action-form";
import { CATEGORY_LABEL } from "@/modules/rules/engine/engine";
import { describeRule, RULE_KINDS, RULE_KIND_KEYS } from "@/modules/rules/engine/kinds";
import type { RuleCategory } from "@/modules/rules/engine/types";
import { RULE_CATEGORIES, ruleInputSchema, type RuleFormInput } from "@/modules/rules/rules.validation";
import { RuleList } from "@/components/policies/RuleList";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { FormGrid, FullWidth, formStyles } from "@/components/ui/Form";
import { Alert, Badge } from "@/components/ui/Surface";

interface Rule {
  id: string;
  category: RuleCategory;
  code: string;
  title: string;
  config: unknown;
  sortOrder: number;
}

function toForm(r?: Rule): RuleFormInput {
  if (!r) return { category: "eligibility", kind: "", code: "", title: "", configJson: "", sortOrder: 0 };
  const { kind, ...rest } = (r.config ?? {}) as { kind?: string };
  return { category: r.category, kind: kind ?? "", code: r.code, title: r.title, configJson: JSON.stringify(rest, null, 2), sortOrder: r.sortOrder };
}

function RuleForm({ initial, save, onDone }: { initial?: Rule; save: (i: RuleFormInput) => Promise<ActionResult>; onDone: () => void }) {
  const { register, handleSubmit, setError, setValue, control, getValues, formState } = useForm<RuleFormInput>({ resolver: zodResolver(ruleInputSchema), defaultValues: toForm(initial) });
  const { formError, apply } = useServerResult(setError);
  const [category, kind, configJson] = useWatch({ control, name: ["category", "kind", "configJson"] });
  const kinds = RULE_KIND_KEYS.filter((k) => (RULE_KINDS[k].categories as RuleCategory[]).includes(category as RuleCategory));

  let preview: string | null = null;
  try {
    preview = kind ? describeRule({ ...JSON.parse(configJson || "{}"), kind }) : null;
  } catch {
    preview = null;
  }
  const e = formState.errors;

  return (
    <form className={formStyles.form} noValidate onSubmit={handleSubmit(async (v) => { if (apply(await save(v))) onDone(); })}>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <FormGrid>
        <SelectField label="Category" required error={e.category?.message} {...register("category", { onChange: () => setValue("kind", "") })}>
          {RULE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </SelectField>
        <SelectField
          label="Rule type"
          required
          error={e.kind?.message}
          {...register("kind", {
            onChange: (ev: { target: { value: string } }) => {
              const k = ev.target.value as keyof typeof RULE_KINDS;
              // Start from the kind's example so admins edit known-good settings.
              if (k && RULE_KINDS[k] && !getValues("configJson").trim()) setValue("configJson", JSON.stringify(RULE_KINDS[k].example, null, 2));
            },
          })}
        >
          <option value="">Select…</option>
          {kinds.map((k) => <option key={k} value={k}>{RULE_KINDS[k].label}</option>)}
        </SelectField>
        <TextField label="Code" required hint="lowercase_with_underscores, unique in this version" error={e.code?.message} {...register("code")} />
        <TextField label="Title" required error={e.title?.message} {...register("title")} />
        <FullWidth>
          <TextAreaField label="Settings (JSON)" rows={8} spellCheck={false} className="mono" error={e.configJson?.message} {...register("configJson")} />
        </FullWidth>
        <TextField label="Display order" type="number" error={e.sortOrder?.message} {...register("sortOrder")} />
      </FormGrid>
      <Alert tone={preview ? "info" : "warning"} title="Preview">
        {preview ?? "Choose a rule type and enter valid settings to see how this rule will read."}
      </Alert>
      <div className={formStyles.actionsInline}>
        <Button type="submit" loading={formState.isSubmitting}>{initial ? "Save rule" : "Add rule"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function RuleEditor({
  rules,
  save,
  remove,
  publish,
  discard,
  today,
}: {
  rules: Rule[];
  save: (ruleId: string | undefined, i: RuleFormInput) => Promise<ActionResult>;
  remove: (ruleId: string) => Promise<ActionResult>;
  publish: (i: { effectiveFrom: string }) => Promise<ActionResult>;
  discard: () => Promise<ActionResult>;
  today: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const done = () => { setEditing(null); router.refresh(); };

  return (
    <div className={formStyles.form}>
      {editing === "new" ? (
        <RuleForm save={(i) => save(undefined, i)} onDone={done} />
      ) : (
        <div><Button variant="secondary" onClick={() => setEditing("new")}>Add rule</Button></div>
      )}
      {RULE_CATEGORIES.map((cat) => {
        const list = rules.filter((r) => r.category === cat);
        return (
          <section key={cat} aria-labelledby={`cat-${cat}`}>
            <h3 id={`cat-${cat}`} className={formStyles.sectionTitle}>
              {CATEGORY_LABEL[cat]} <Badge tone={list.length ? "neutral" : "warning"}>{list.length}</Badge>
            </h3>
            {list.map((r) =>
              editing === r.id ? (
                <RuleForm key={r.id} initial={r} save={(i) => save(r.id, i)} onDone={done} />
              ) : (
                <RuleList
                  key={r.id}
                  rules={[r]}
                  empty=""
                  actions={() => (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(r.id)}>Edit</Button>
                      <ConfirmButton label="Delete" title={`Delete "${r.title}"?`} body="The rule is removed from this draft only. Published versions are unchanged." confirmLabel="Delete rule" tone="danger" action={() => remove(r.id)} onDone={() => router.refresh()} />
                    </>
                  )}
                />
              ),
            )}
            {!list.length && <p className={formStyles.sectionHint}>No rules — checks in this category will need manual verification.</p>}
          </section>
        );
      })}
      <Alert tone="warning" title="Publishing">
        Publishing makes this version active for all new eligibility checks and retires the current version. Past evaluations keep referring to the version they used.
      </Alert>
      <div className={formStyles.actionsInline}>
        <TextField label="Effective from" type="date" value={effectiveFrom} onChange={(ev) => setEffectiveFrom(ev.target.value)} />
      </div>
      <div className={formStyles.actionsInline}>
        <ConfirmButton label="Publish version" title="Publish this rule version?" body="It becomes the active rule set immediately. This can't be edited afterwards — changes need a new draft." confirmLabel="Publish" action={() => publish({ effectiveFrom })} onDone={() => router.refresh()} />
        <ConfirmButton label="Discard draft" title="Discard this draft?" body="All changes in this draft are removed. The active version is not affected." confirmLabel="Discard" tone="danger" action={discard} onDone={() => router.refresh()} />
      </div>
    </div>
  );
}
