# Plan: Honorarios global (Find Your Way, deadline 2026-10-12 18:59)

Source of the plan: four-judge agnostic simulation on 2026-10-05 against Local402, Habeas and
AgentAllowance. Totals out of 240: Local402 184, Habeas 183, AgentAllowance 178, Honorarios 166.
Three of four judges ranked Honorarios last for the same reason: one-country niche, no users,
no clear payer. The designer ranked it first for clarity.

Odyssey repo (`../honorarios`) is not touched.

## A. Contract v2: any country, any rate (no invented tax rules)
- Freelancer profile: reserve rate in basis points (capped) and the UTC offset of their tax month.
- Each receipt snapshots the rate and offset at issue time, so a later change never alters a
  receipt the client already saw.
- Peru stays the only verified preset (8%, SUNAT threshold, cited). Other countries: the
  freelancer chooses the percentage; the app does not claim to know their law.
- Tests for the new paths plus randomized split invariants. Threat model in docs.

## B. Frontend
- Country step: Peru preset or "set your own percentage and time zone".
- Peru-only screens (threshold, SUNAT draft) appear only with the Peru preset.
- Global copy on the landing.

## C. Stellar depth
- Verified build (SEP-55) through a GitHub release workflow.
- Mainnet deployment and one real payment. Needs the user's OK and a few XLM and USDC.

## D. Impact and business
- Discovery with sources in `docs/discovery/`.
- Market size and business model from those sources only.
- README restructured: global problem first, Peru as the first verified jurisdiction.

## E. Demo and video
- A judge can see a full payment in about two minutes.
- Video redone at the end, from the final build.
