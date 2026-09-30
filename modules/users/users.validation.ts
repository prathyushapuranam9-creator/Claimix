import { z } from "zod";
import { emailSchema } from "@/modules/auth/auth.validation";
import { zName, zUuid } from "@/lib/validation";

export const userCreateSchema = z.object({
  email: emailSchema,
  fullName: zName,
  roleId: zUuid,
  organizationId: zUuid,
});

export const userUpdateSchema = z.object({
  fullName: zName,
  roleId: zUuid,
  isActive: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
});

export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserUpdateInput = z.input<typeof userUpdateSchema>;
