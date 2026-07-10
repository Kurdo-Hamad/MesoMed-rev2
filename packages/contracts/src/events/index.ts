import { z } from "zod";

/**
 * Event contracts per MM-PLAN-001 §3.3: every event is `{ name, version,
 * payload }`, additive changes only — a breaking change is a new version,
 * with old handlers kept until drained.
 *
 * Event names are branded at the type level as `module.event.vN`
 * (MM-QA-001 F-20): a bare string does not satisfy `EventName`, so an
 * unversioned or free-form name is a compile error at every kernel
 * boundary (emit, registry, handler subscription).
 */
export type EventName = `${string}.${string}.v${number}`;

const NAME_PART = /^[a-z][a-z0-9_]*$/;

export interface EventContract<
  Name extends EventName = EventName,
  Version extends number = number,
  Payload extends z.ZodType = z.ZodType,
> {
  readonly name: Name;
  readonly version: Version;
  readonly payload: Payload;
  /** Full envelope schema — the single runtime validator for this event. */
  readonly envelope: z.ZodObject<{
    name: z.ZodLiteral<Name>;
    version: z.ZodLiteral<Version>;
    payload: Payload;
  }>;
}

/** The parsed envelope type of a given contract. */
export type EventEnvelope<Contract extends EventContract> = z.infer<Contract["envelope"]>;

/** An envelope validated by the registry without knowing the contract statically. */
export interface AnyEventEnvelope {
  name: EventName;
  version: number;
  payload: unknown;
}

/**
 * Declares an event contract. The name is assembled — never passed as a
 * whole string — so the `module.event.vN` shape is guaranteed by
 * construction and carried in the type.
 */
export function defineEvent<
  const Module extends string,
  const Event extends string,
  const Version extends number,
  Payload extends z.ZodType,
>(
  module: Module,
  event: Event,
  version: Version,
  payload: Payload,
): EventContract<`${Module}.${Event}.v${Version}`, Version, Payload> {
  if (!NAME_PART.test(module) || !NAME_PART.test(event)) {
    throw new Error(
      `Invalid event name segment "${module}.${event}": segments must match ${String(NAME_PART)}`,
    );
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid event version ${version}: must be a positive integer`);
  }
  const name = `${module}.${event}.v${version}` as const;
  return {
    name,
    version,
    payload,
    envelope: z.object({ name: z.literal(name), version: z.literal(version), payload }),
  };
}

/** Thrown when an envelope names an event no contract was registered for. */
export class UnknownEventError extends Error {
  constructor(readonly eventName: string) {
    super(`No event contract registered for "${eventName}"`);
    this.name = "UnknownEventError";
  }
}

const envelopeHead = z.object({ name: z.string(), version: z.number(), payload: z.unknown() });

export interface EventRegistry {
  /** All registered event names. */
  names(): EventName[];
  get(name: string): EventContract | undefined;
  /** Look up the contract by envelope name and validate the full envelope. */
  parse(input: unknown): AnyEventEnvelope;
}

/**
 * The registry is the app-wide catalog of event contracts; the kernel
 * validates every envelope against it on emit and again on delivery.
 */
export function createEventRegistry(contracts: readonly EventContract[]): EventRegistry {
  const byName = new Map<EventName, EventContract>();
  for (const contract of contracts) {
    if (byName.has(contract.name)) {
      throw new Error(`Duplicate event contract "${contract.name}"`);
    }
    byName.set(contract.name, contract);
  }
  return {
    names: () => [...byName.keys()],
    get: (name) => byName.get(name as EventName),
    parse: (input) => {
      const head = envelopeHead.parse(input);
      const contract = byName.get(head.name as EventName);
      if (!contract) throw new UnknownEventError(head.name);
      return contract.envelope.parse(input) as AnyEventEnvelope;
    },
  };
}
