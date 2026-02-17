# Brooke's Classroom Security Review

Date: February 16, 2026  
Reviewer: Senior Engineering Audit (Codex)

## Scope
This review covers:
1. Backend API and realtime server (`server.js`)
2. Frontend teacher/display/student clients (`public/*.js`, `public/*.html`)
3. State persistence model (`data/state.json`)
4. Operational/documentation hygiene (`README.md`)

## Stack Summary
1. Backend: single-process Node.js `http` server, no framework.
2. Frontend: static HTML + vanilla JS modules with SSE.
3. Storage: local JSON file (`data/state.json`) with in-memory state and queued writes.
4. Realtime: server-sent events broadcasting state and events.

## Findings (Ordered by Severity)

### Critical
1. No authentication/authorization for teacher/admin APIs.
   - Risk: any network-reachable client can mutate or reset class data.
   - References: `server.js:1187`, `server.js:1493`, `server.js:1720`, `server.js:1836`, `server.js:1995`, `server.js:2046`

2. Student access codes are exposed in global state APIs/SSE.
   - Risk: private student codes are leaked, undermining student-access controls.
   - References: `server.js:1187`, `server.js:1204`, `server.js:700`, `data/state.json:36`

3. Potential XSS via unescaped `photo` data URLs used in `innerHTML`.
   - Risk: attacker-crafted payloads could execute script in clients.
   - References: `server.js:160`, `public/shared.js:54`, `public/shared.js:68`, `public/student.js:373`

### High
4. Data-loss path on parse failure + non-atomic file writes.
   - Risk: corrupted JSON can cause reset to defaults and complete class data loss.
   - References: `server.js:693`, `server.js:695`, `server.js:713`

5. No rate-limiting/lockout on access-code endpoints.
   - Risk: brute-force discovery of valid 5-letter student codes.
   - References: `server.js:18`, `server.js:19`, `server.js:1214`, `server.js:1230`, `server.js:1253`

6. Student profile supports ID-based access without code.
   - Risk: profiles can be opened from direct IDs without private code flow.
   - References: `public/display.js:337`, `public/student.js:116`, `public/student.js:138`, `server.js:1187`

7. Sensitive student data stored plaintext.
   - Risk: names/photos/access codes are readable at rest by host access.
   - References: `data/state.json:35`, `data/state.json:36`, `data/state.json:37`

### Medium
8. SSE sends full state payload for each update.
   - Risk: bandwidth/CPU scaling issues; increased data exposure surface.
   - References: `server.js:975`, `server.js:979`, `server.js:990`

9. Direct points patch can cause data integrity drift.
   - Risk: points can diverge from XP/level/streak logic.
   - References: `server.js:1562`, `server.js:1111`, `server.js:1810`

10. Shoutout approval can be repeated and generate duplicate events.
   - Risk: duplicate activity records / inconsistent moderation state.
   - References: `server.js:1360`, `server.js:1367`

11. Missing hardening headers + unpinned third-party runtime scripts.
   - Risk: broader browser attack surface and supply-chain risk.
   - References: `server.js:2086`, `public/student.html:22`, `public/student.html:25`

### Low
12. Documentation drift: README port mismatches runtime default.
   - Risk: operational confusion.
   - References: `README.md:44`, `server.js:7`

13. No automated test suite found.
   - Risk: regressions in scoring, streak logic, and permissions.
   - References: repository-level audit (no `test`/`spec` files detected)

## Recommended Improvement Plan

### Phase 1 (Immediate)
1. Add teacher authentication (session cookie + password/passkey).
2. Restrict all mutating routes to authenticated teacher role.
3. Stop exposing access codes in `/api/state` and SSE payloads.
4. Remove or lock down `/student?id=...` mode (prefer signed token or code-only).
5. Enforce strict server validation for image uploads and safe attribute rendering.

### Phase 2 (Near-term)
1. Add request throttling for access-code and shoutout endpoints.
2. Implement atomic state writes with backup rotation.
3. Add security headers (CSP, nosniff, frame protections, referrer policy).
4. Pin/self-host third-party scripts used by student profile rendering.

### Phase 3 (Stability & Scale)
1. Move from full-state SSE to event-delta streaming.
2. Separate large media payloads from state responses.
3. Add tests for:
   - Auth/authorization
   - Streak transitions
   - XP/level progression
   - Season rollover
   - Shoutout moderation state transitions

## Notable Strengths
1. Good baseline input normalization for IDs, skill values, and many text fields.
2. Path traversal protection in static file serving.
3. Reasonable payload size cap for JSON bodies.
4. Clean single-binary deployment model for local classroom use.

## Open Questions for Product/Operations
1. LAN-only deployment or internet exposure?
2. Required privacy/compliance standard for minors' data?
3. Trust model for display devices (trusted classroom only vs semi-public)?

