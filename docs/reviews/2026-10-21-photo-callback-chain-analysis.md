# Photo-derived callback chain investigation

Observed UI: Dynsight 0.1.60, 196 indexed files, partial index, region/mutation
notices and a project 10-second timeout. The selected preprocess callback has
zero candidates and no Callback analysis details.

The supplied photographs now establish the visible source chain:

1. `product_task_data.c` table `.cb_preprocess=priv_data_non_safety_preprocess`.
2. Public getter returns `&priv_data_safety_non_safety_callbacks`.
3. `priv_ctrl_start` supplies the getter result as the third argument to
   `safety_task_data_stage_init` after conditional setup.
4. Stage initialization checks context, result pointer, table and callback
   fields, then stores `priv_non_safety_callbacks=cbs` under `if(ret==0)`.
5. Stage preprocess checks the table and member before invoking the member.

Run `npx tsx docs/reviews/2026-10-21-photo-callback-chain-repro.ts`.
The reduced model uses four files, eight table fields, third-argument forwarding,
NULL checks, guarded stores and the visible invocation pattern. Other callback
signatures, device functions and the actual error-code macro are simplified;
this is not the user's full WSL source.

Results: three source-order variants resolve the intended preprocess function
with incomplete=false and no notices. With an artificially advanced clock that
consumes the existing deadline at setup, the same model produces a project time
notice but leaves the raw indirect call with zero targets, incomplete=true and
reasons=[]. `webview/main.ts` only creates Callback analysis when reasons exist.
Thus an unobserved call after a stop can reproduce the displayed zero-target,
no-details state. The simulation stops at setup; the user's photo stops during
propagation. This proves a possible failure path, not the exact point at which
the user's call was skipped or whether other unknown mutations also affect it.

No production code, limits or published artifacts were changed during this
investigation. The known visible registration pattern is supported in isolation.
Remaining investigation concerns coverage/convergence under whole-project
budgets and per-call diagnosis when no observation was produced. No further
photographs of this registration chain are needed.
