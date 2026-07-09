// Process entry point. The dynamic-import sequence is load-bearing:
// instrumentation must finish evaluating (installing its module-load hooks)
// before the server chunk pulls in fastify/pino/http (MM-QA-001 F-03,
// ADR-0002). Static imports would hoist and silently defeat this.
await import("./instrumentation.js");
await import("./server.js");
