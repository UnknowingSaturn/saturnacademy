## Verification result: 9 of 10 S4 items landed correctly; 1 parity gap on the edge mirror

### Verified correct
- **S4.1** `useTrades.tsx` paginates via `.range()` with a hard cap.
- **S4.2** `ensureUtcMs` sweep complete in `idealWindowMath.ts`, `propFirmMonteCarlo.ts`, `usePairLabTradeBounds.ts` — no remaining `Date.parse` / `new Date(string)` on trade timestamps in those files.
- **S4.3** `usePairLab.tsx#matchesScope` parses `dateFrom` / `dateTo` / `entry_time` through `ensureUtcMs` instead of string-compare.
- **S4.4** Kelly uses `rWinRate` from the R-subsample population and exposes `rCoverageWarning` — landed in **both** `src/lib/pairLabMath.ts` and `supabase/functions/_shared/quant/pairLabMath.ts`; `BucketReport` / `BucketRecommendation` types extended on both sides.
- **S4.5** `pair-lab-report/index.ts` reads `idealSlMedianPips` / `slInitialMedianPips` (matches the renamed client fields). AI quant note will populate SL drift again.
- **S4.6 (client only)** `src/lib/pairLabSimulator.ts:388` now books `-slScale * remainingFrac` when the runner stopped under the new SL after a partial fill. The other-arm `lastFilledAtR * remainingFrac` at line 398 is the not-stopped branch and is correct.
- **S4.7** TP-grid ceiling uses interpolated `quantile(sortedMfe, 0.95)` in both client and edge.
- **S4.8** `scripts/verify_pair_lab_math.ts` filter now mirrors `buildBuckets` (`!isUnrealized(t)` instead of `net_pnl != null`); `isUnrealized` is imported.
- **S4.10** `STRATEGY_PRESETS.current` exitRule uses empty `partials`; `usePairLab` JSDoc updated to reference `TRAIL_CAPTURE_FALLBACK`.
- Project typecheck (`bunx tsgo --noEmit`) is clean.

### Outstanding — single parity gap

**S4.6 edge mirror not patched.** `supabase/functions/_shared/quant/pairLabSimulator.ts:243` still reads:

```ts
else if (strategy.exitRule.runner === "all_out_at_last_partial") booked += lastFilledAtR * remainingFrac;
```

inside the `stoppedUnderNewSl && anyFilled` branch. Every server-side preset replay that triggers this path (notably the `*_all_out_at_last_partial` presets seeded in this same file) will continue to overstate expectancy by `(lastFilledAtR + slScale) × remainingFrac`, so the AI report's preset rankings and the client `StrategyRanker` will diverge for any bucket whose dominant losers came after a partial fill.

### Proposed fix (one-line, mirrors client S4.6)

`supabase/functions/_shared/quant/pairLabSimulator.ts` line 243 — change the stopped-under-new-SL arm only (leave line 251 untouched):

```ts
else if (strategy.exitRule.runner === "all_out_at_last_partial") booked += -slScale * remainingFrac;
```

Add a short `// S4.6 parity:` comment referencing the client fix so the next audit can grep for it.

### Optional follow-up (not in S4 scope)

The `WARNED_SESSIONS` Set leak (L3), `brokerDst.ts:98` half-hour offsets (L2), and edge `BucketReport.slSweep` (L1) remain deferred as planned — call them out only if you want them folded in.

### Recommendation

Approve to land the one-line edge mirror patch and re-run typecheck. No other changes needed for S4 to be fully closed.