# ADR-0015 — Organization / Tenant Reserved Design (design only)

**Status:** Accepted (reserved design — **nothing implemented**)
**Phase:** 8 (obligation per MM-ARC-002 §1.11, restated in the Phase 8
kickoff instruction).
**Builds on:** ADR-0004 (identity, roles), convention #6 (two-layer
authorization).

## Purpose

Reserve the shape a future multi-organization capability (hospital groups,
clinic chains, franchise operators) will take, so nothing built now
forecloses it. This ADR is a design sketch only: **no tables, columns,
procedures, or code land in Phase 8**, and none should be built until a
real organization customer exists (convention #8's discipline applied to
schema).

## Reserved shape

```
organization
  id            uuid pk
  slug          text unique
  name_{en,ar,ckb}
  active        boolean            -- ADR-0014 regime 2

organization_membership
  id            uuid pk
  organization_id  fk → organization
  user_id          fk → user
  org_role         text            -- e.g. 'owner' | 'manager' | 'staff'
  active           boolean
  unique (organization_id, user_id)
```

Organization-owned resources (facilities, doctor profiles, locations) gain
a nullable `organization_id`; null keeps today's individually-owned rows
valid forever.

## The one binding rule

**Org scoping extends the ownership layer (§3.6 layer b), never the role
layer (layer a).** Platform roles stay exactly `patient | doctor |
secretary | admin` — `org_role` is a _resource-relationship attribute_
evaluated inside command/query handlers, alongside today's
owning-doctor/assigned-secretary checks:

- Today: "may manage this doctor-location" = admin ∨ owning doctor ∨
  assigned secretary.
- Then: … ∨ active org membership with a managing `org_role` over the
  organization that owns the resource.

Kernel `roleProcedure(...)` guards, the `Session` shape, and the authz
middleware do not change. An org manager who is not a doctor holds only
the roles they hold today; what grows is the set of resources their
layer-b checks accept. This keeps the layer-a surface enumerable (the
authz denial matrices stay complete) and confines multi-tenancy to the
same seam that already expresses ownership.

## Explicitly not decided now

Billing aggregation across an org, org-level dashboards, invitation flows,
and whether `org_role` is an enum or a permission set — all deferred to
the phase that builds organizations against a real customer.
