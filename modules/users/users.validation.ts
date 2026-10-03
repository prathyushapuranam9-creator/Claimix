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

/**
 * What a signed-in user may change about themselves: name and sign-in email (the current
 * password is required when the email changes). Role, organization and status are
 * admin-controlled and are not part of this schema, so they can't be sent.
 */
export const profileUpdateSchema = z.object({
  fullName: zName,
  email: emailSchema,
  currentPassword: z.string().max(200).optional(),
});

export type ProfileUpdateInput = z.input<typeof profileUpdateSchema>;
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserUpdateInput = z.input<typeof userUpdateSchema>;
