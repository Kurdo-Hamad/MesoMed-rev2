# Phase 10 Slice 4 (ADR-0030): k6 runner deployed NEXT TO the API in the
# scratch environment so latency measurements exclude the operator's WAN.
# The container idles; runs are executed interactively (railway ssh).
FROM grafana/k6:0.58.0
COPY lib.js loadtest.js contention.js /scripts/
WORKDIR /scripts
ENTRYPOINT []
CMD ["sleep", "infinity"]
