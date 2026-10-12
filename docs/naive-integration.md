# Naïve pre-confirmation integration example

Status: an original adapter plus a small React advisory panel, locally typechecked/tested against the public interface. **Not installed in a live Naïve/Vetta organization.** No calls to a live platform were made.

## Pinned reference

Repository: `usenaive/agency-blueprint`, commit `012751bba8c4b167c3d8e66acdc102b85e35ccfe`.

- [Approvals screen](https://github.com/usenaive/agency-blueprint/blob/012751bba8c4b167c3d8e66acdc102b85e35ccfe/src/screens/Approvals.tsx): `row.action.args` is available before `decide()` posts to `/sessions/${row.session.id}/tool_confirmations`.
- [Pending action types](https://github.com/usenaive/agency-blueprint/blob/012751bba8c4b167c3d8e66acdc102b85e35ccfe/src/platform.ts): `kind`, `tool_call_id`, `name`, `args`.
- [MCP tool](https://github.com/usenaive/agency-blueprint/blob/012751bba8c4b167c3d8e66acdc102b85e35ccfe/server/mcp.ts): the action name is `dashboard.update_site`, and arguments are `{ site: { ...wholeSectionReplacements } }`.
- [Site schema](https://github.com/usenaive/agency-blueprint/blob/012751bba8c4b167c3d8e66acdc102b85e35ccfe/site/site.config.ts): sections are replaced whole, not recursively patched. Strings are bounded at 2,000 and lists at 24.

A hook in the `update_site` execution handler is too late: the human has already allowed the call. The slot belongs in the pending approval card, immediately above its existing decision controls. Keep the question/answer cards, existing Approve/Reject controls and authoritative post-confirmation platform response unchanged.

## Client slot

Copy or import the original files under `integration/`, with the shared/client validation modules they reference. The host supplies the current complete site and a deliberately approved evidence pack. Use the authoritative target/organization identity; do not invent it from display text.

```tsx
// In the normal tool-action card, before the existing outcome/Approve/Reject block.
// `currentSite`, `approvedEvidence`, `targetId`, and `briefCheckConfig` must be loaded
// through the host's authenticated APIs, with loading/error states shown explicitly.
const prepared = preparePendingReview(
  row,
  currentSite,
  approvedEvidence,
  targetId,
);

<NaiveReviewPanel
  prepared={prepared}
  config={briefCheckConfig}
  load={async (input, liveConsent) => {
    const response = await fetch("/api/briefcheck/reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(liveConsent ? { "X-BriefCheck-Live-Consent": "1" } : {}),
      },
      body: JSON.stringify(input),
    });
    return { ...(await response.json()), ok: response.ok };
  }}
/>;
```

The panel shows unsupported shapes as unavailable, ignores unrelated tools/questions, invalidates reports when any input/config changes, prevents stale in-flight responses from appearing, displays exact excerpts/evidence, and never calls confirmation or execution APIs. Its key includes both session and call ID, using a serialized tuple to avoid delimiter collisions. A client freshness check is for display only; it does not authorize any action.

## Server wiring

The standalone Express server is loopback-only and has no user accounts. Do not transplant it into a public host without security work. A real integration should mount a new authenticated, read-only review route in the host app:

1. Resolve the authenticated organization, target site, pending session and pending action server-side; check that the action still exists and is exactly `dashboard.update_site`.
2. Load the current site and approved evidence from host-controlled records. Compare the client's snapshot to this authoritative state; if stale, return 409 and require a fresh review. A browser may not nominate another tenant's source pack or target.
3. Run `preparePendingReview(authoritativeRow, authoritativeSite, authoritativeEvidence, authoritativeTargetId)` and reject anything other than `ready`.
4. Enforce the live-consent header when configured for TypeSafe; use the host's normal authentication, origin/CSRF controls, request-size, concurrency and cost budgets. Do not weaken host protections.
5. Call the server-only `review(prepared.input, provider)` using `SimulatedProvider` by default or a server-created `TypeSafeProvider`. Return status 502 on `report.error`, otherwise 200 with `{ report }`. Return only public provider identity, rubric version and threshold from a small authenticated config route.
6. Leave the existing `/tool_confirmations` flow entirely in the human decision path. A valid report does not imply permission. No auto-allow, auto-reject, direct `update_site`, or prompt-driven external call is added.

The host-specific authentication/evidence storage and route mounting are intentionally instructions, not fabricated installed infrastructure. The minimal supplied component + mapping adapter demonstrate the correct insertion point without forking the blueprint.

## Coverage limits

The reviewer supports nine textual sections and at most six changed sections per review. Noncopy/unsupported sections and partial shapes are explicitly unavailable, even if Naïve itself might accept them. BriefCheck's schema is intentionally stricter than upstream's permissive shape checker. A mixed supported/unsupported patch is entirely unavailable so an unreviewed change cannot hide behind a clean result. Human review still applies to every operation.
