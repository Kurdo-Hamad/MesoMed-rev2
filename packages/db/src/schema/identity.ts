import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Identity module tables (MM-PLAN-001 §5 Phase 2, MM-DEC rev02) — owned
 * exclusively by `apps/api/src/modules/identity` (§3.1). They live in this
 * package because drizzle-kit and the migration journal are centralized
 * here (same precedent as the kernel tables; recorded in ADR-0004).
 *
 * `user`/`session`/`account`/`verification` are Better Auth's tables,
 * transcribed from the resolved schema of the installed better-auth
 * version (getAuthTables with the phone-number plugin — regenerate via
 * apps/api/scripts/auth-cli-config.ts after upgrades). Better Auth manages
 * their rows; identity module code reads them but writes only through the
 * Better Auth API, except for the module-owned tables below.
 */

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // phone-number plugin fields
    phoneNumber: text("phone_number"),
    phoneNumberVerified: boolean("phone_number_verified"),
  },
  (table) => [
    uniqueIndex("user_email_unique").on(table.email),
    uniqueIndex("user_phone_number_unique").on(table.phoneNumber),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// ── Module-owned tables ────────────────────────────────────────────────

export const IDENTITY_ROLES = ["patient", "doctor", "secretary", "admin"] as const;

/** Role assignments backing the kernel authz middleware (§3.6 layer a). */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: IDENTITY_ROLES }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_roles_user_id_role_unique").on(table.userId, table.role),
    check(
      "user_roles_role_check",
      sql`${table.role} in ('patient', 'doctor', 'secretary', 'admin')`,
    ),
  ],
);

export const PATIENT_GENDERS = ["male", "female"] as const;

/**
 * Patient profiles, keyed on the normalized phone (MM-DEC rev02 §1/§9).
 * `userId` null = unverified guest profile created at booking; the claim
 * command sets it exactly once (unique) when ownership is proven.
 */
export const patientProfiles = pgTable(
  "patient_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    normalizedPhone: text("normalized_phone").notNull(),
    fullName: text("full_name").notNull(),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender", { enum: PATIENT_GENDERS }),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("patient_profiles_normalized_phone_unique").on(table.normalizedPhone),
    uniqueIndex("patient_profiles_user_id_unique").on(table.userId),
    check("patient_profiles_gender_check", sql`${table.gender} in ('male', 'female')`),
  ],
);

export const PROVIDER_PROFILE_TYPES = [
  "doctor",
  "hospital",
  "laboratory",
  "pharmacy",
  "home_nursing",
] as const;

export const PROVIDER_PROFILE_STATUSES = ["pending", "approved", "rejected"] as const;

/**
 * Provider accounts (MM-DEC rev02 §3): created at signup with
 * status=pending; login-capable while pending; publicly visible only when
 * approved. `phone` is operational/recovery only — never an auth factor.
 */
export const providerProfiles = pgTable(
  "provider_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerType: text("provider_type", { enum: PROVIDER_PROFILE_TYPES }).notNull(),
    status: text("status", { enum: PROVIDER_PROFILE_STATUSES }).notNull().default("pending"),
    phone: text("phone").notNull(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusChangedBy: text("status_changed_by").references(() => user.id),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_profiles_user_id_unique").on(table.userId),
    index("provider_profiles_status_idx").on(table.status),
    check(
      "provider_profiles_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      "provider_profiles_type_check",
      sql`${table.providerType} in ('doctor', 'hospital', 'laboratory', 'pharmacy', 'home_nursing')`,
    ),
  ],
);

/**
 * OTP send ledger for per-phone rate limiting (MM-DEC rev02 §8). Rows are
 * pruned opportunistically once they leave every policy window.
 */
export const otpSendAttempts = pgTable(
  "otp_send_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    normalizedPhone: text("normalized_phone").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("otp_send_attempts_phone_sent_at_idx").on(table.normalizedPhone, table.sentAt)],
);
