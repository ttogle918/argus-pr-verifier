import { PullRequestTarget, VerificationReport } from '../types/verification';

export const PR_PRESETS: PullRequestTarget[] = [
  {
    id: 'pr-escrow-settlement',
    repo: 'acme-clearing/settlement-engine',
    prNumber: 418,
    title: 'feat(ledger): batch multi-party escrow release with fee split & idempotency',
    author: 'codegen-bot[bot]',
    aiGenerator: 'Autonomous PR Agent',
    branch: 'ai/batch-escrow-release-418',
    baseBranch: 'main',
    commitSha: '9f3c2a1b',
    timestamp: '2026-10-15T18:12:00Z',
    description:
      'Refactors EscrowLedger.release_batch() to support partial milestone payouts, basis-point platform fee deduction, and idempotency key caching across retries.',
    filePath: 'settlement/escrow_ledger.py',
    language: 'python',
    code: `from typing import Dict, List, Any

class EscrowLedger:
    def __init__(self, platform_fee_bps: int = 250):
        # platform_fee_bps: 250 = 2.50%
        self.platform_fee_bps = platform_fee_bps
        self.escrow_balances: Dict[str, int] = {}
        self.recipient_balances: Dict[str, int] = {}
        self.platform_treasury: int = 0
        self.processed_batches: Dict[str, Dict[str, Any]] = {}
        self.audit_log: List[Dict[str, Any]] = []

    def deposit(self, account_id: str, amount_cents: int) -> int:
        if amount_cents <= 0:
            raise ValueError("Deposit must be positive integer cents")
        self.escrow_balances[account_id] = self.escrow_balances.get(account_id, 0) + amount_cents
        return self.escrow_balances[account_id]

    def release_batch(
        self,
        idempotency_key: str,
        source_account: str,
        payouts: List[Dict[str, Any]],
        actor_role: str = "operator"
    ) -> Dict[str, Any]:
        """
        Releases a batch of payouts from source_account escrow.
        Each item in payouts: {"recipient": str, "amount_cents": int}
        """
        # Cache hit for idempotent replay
        if idempotency_key in self.processed_batches:
            return self.processed_batches[idempotency_key]

        if actor_role not in ("operator", "settlement_admin", "system"):
            raise PermissionError("Unauthorized actor role")

        current_escrow = self.escrow_balances.get(source_account, 0)
        total_requested = sum(item["amount_cents"] for item in payouts)

        if total_requested > current_escrow:
            raise ValueError("Insufficient escrow balance for batch release")

        total_net_paid = 0
        total_fee_collected = 0

        for item in payouts:
            gross = item["amount_cents"]
            recipient = item["recipient"]
            # BUG 1: Missing negative individual payout check when total sum stays <= current_escrow
            # BUG 2: Float round() causes conservation of money drift on half-even rounding
            fee = int(round(gross * (self.platform_fee_bps / 10000.0)))
            net = gross - fee

            # Mutates state inside loop before validating all recipients
            if not recipient or not isinstance(recipient, str):
                raise ValueError("Invalid recipient identifier")

            self.escrow_balances[source_account] -= gross
            self.recipient_balances[recipient] = self.recipient_balances.get(recipient, 0) + net
            self.platform_treasury += fee

            total_net_paid += net
            total_fee_collected += fee

        result = {
            "idempotency_key": idempotency_key,
            "source_account": source_account,
            "gross_released": total_requested,
            "net_disbursed": total_net_paid,
            "fee_collected": total_fee_collected,
            "remaining_escrow": self.escrow_balances.get(source_account, 0),
            "payout_count": len(payouts),
        }
        # BUG 3: Key cached only by idempotency_key without binding payload hash
        self.processed_batches[idempotency_key] = result
        self.audit_log.append(result)
        return result
`,
    diff: `@@ -21,15 +21,49 @@ class EscrowLedger:
-    def release_single(self, source_account: str, recipient: str, amount_cents: int) -> Dict[str, Any]:
-        if amount_cents <= 0:
-            raise ValueError("Amount must be positive")
-        if self.escrow_balances.get(source_account, 0) < amount_cents:
-            raise ValueError("Insufficient escrow")
-        fee = (amount_cents * self.platform_fee_bps) // 10000
-        net = amount_cents - fee
-        self.escrow_balances[source_account] -= amount_cents
-        self.recipient_balances[recipient] = self.recipient_balances.get(recipient, 0) + net
-        self.platform_treasury += fee
-        return {"gross": amount_cents, "net": net, "fee": fee}
+    def release_batch(
+        self,
+        idempotency_key: str,
+        source_account: str,
+        payouts: List[Dict[str, Any]],
+        actor_role: str = "operator"
+    ) -> Dict[str, Any]:
+        if idempotency_key in self.processed_batches:
+            return self.processed_batches[idempotency_key]
+
+        if actor_role not in ("operator", "settlement_admin", "system"):
+            raise PermissionError("Unauthorized actor role")
+
+        current_escrow = self.escrow_balances.get(source_account, 0)
+        total_requested = sum(item["amount_cents"] for item in payouts)
+
+        if total_requested > current_escrow:
+            raise ValueError("Insufficient escrow balance for batch release")
+
+        total_net_paid = 0
+        total_fee_collected = 0
+
+        for item in payouts:
+            gross = item["amount_cents"]
+            recipient = item["recipient"]
+            fee = int(round(gross * (self.platform_fee_bps / 10000.0)))
+            net = gross - fee
+
+            if not recipient or not isinstance(recipient, str):
+                raise ValueError("Invalid recipient identifier")
+
+            self.escrow_balances[source_account] -= gross
+            self.recipient_balances[recipient] = self.recipient_balances.get(recipient, 0) + net
+            self.platform_treasury += fee
+
+            total_net_paid += net
+            total_fee_collected += fee`
  },
  {
    id: 'pr-token-bucket',
    repo: 'nexus-gateway/rate-limiter',
    prNumber: 209,
    title: 'perf(limiter): adaptive burst token bucket with tenant quota borrowing',
    author: 'dev-agent-v4[bot]',
    aiGenerator: 'Autonomous PR Agent',
    branch: 'ai/adaptive-burst-borrow-209',
    baseBranch: 'main',
    commitSha: '4d81e07c',
    timestamp: '2026-10-15T16:40:00Z',
    description:
      'Adds burst borrowing from reserve pool when tenant requests exceed nominal bucket capacity, with monotonic refill math and tenant tier overrides.',
    filePath: 'limiter/token_bucket.py',
    language: 'python',
    code: `from typing import Dict, Any

class TenantRateLimiter:
    def __init__(self, default_capacity: int = 100, refill_per_sec: float = 10.0, shared_reserve: int = 500):
        self.default_capacity = default_capacity
        self.refill_per_sec = refill_per_sec
        self.shared_reserve = shared_reserve
        self.buckets: Dict[str, Dict[str, Any]] = {}

    def _ensure_bucket(self, tenant_id: str, now_ts: float) -> Dict[str, Any]:
        if tenant_id not in self.buckets:
            self.buckets[tenant_id] = {
                "tokens": float(self.default_capacity),
                "last_ts": now_ts,
                "borrowed": 0
            }
        return self.buckets[tenant_id]

    def consume(self, tenant_id: str, cost: int, now_ts: float, allow_borrow: bool = False) -> Dict[str, Any]:
        bucket = self._ensure_bucket(tenant_id, now_ts)

        # BUG 1: Clock skew (now_ts < last_ts) drains tokens instead of clamping delta >= 0
        elapsed = now_ts - bucket["last_ts"]
        refilled = elapsed * self.refill_per_sec
        bucket["tokens"] = min(float(self.default_capacity), bucket["tokens"] + refilled)
        bucket["last_ts"] = now_ts

        # BUG 2: Zero or negative cost inflates token balance above capacity
        if bucket["tokens"] >= cost:
            bucket["tokens"] -= cost
            return {"allowed": True, "remaining": bucket["tokens"], "borrowed": 0}

        if allow_borrow:
            deficit = int(cost - bucket["tokens"])
            if self.shared_reserve >= deficit:
                self.shared_reserve -= deficit
                bucket["borrowed"] += deficit
                bucket["tokens"] = 0.0
                return {"allowed": True, "remaining": 0.0, "borrowed": deficit}

        return {"allowed": False, "remaining": bucket["tokens"], "borrowed": 0}
`,
    diff: `@@ -14,12 +14,27 @@ class TenantRateLimiter:
     def consume(self, tenant_id: str, cost: int, now_ts: float, allow_borrow: bool = False) -> Dict[str, Any]:
         bucket = self._ensure_bucket(tenant_id, now_ts)
         elapsed = now_ts - bucket["last_ts"]
         refilled = elapsed * self.refill_per_sec
         bucket["tokens"] = min(float(self.default_capacity), bucket["tokens"] + refilled)
         bucket["last_ts"] = now_ts
-        if cost <= 0:
-            raise ValueError("Cost must be positive")
         if bucket["tokens"] >= cost:
             bucket["tokens"] -= cost
             return {"allowed": True, "remaining": bucket["tokens"], "borrowed": 0}
+        if allow_borrow:
+            deficit = int(cost - bucket["tokens"])
+            if self.shared_reserve >= deficit:
+                self.shared_reserve -= deficit
+                bucket["borrowed"] += deficit
+                bucket["tokens"] = 0.0
+                return {"allowed": True, "remaining": 0.0, "borrowed": deficit}`
  },
  {
    id: 'pr-jwt-session-rotator',
    repo: 'vault-auth/session-guard',
    prNumber: 892,
    title: 'security(auth): sliding refresh token rotation with grace window',
    author: 'synth-coder[bot]',
    aiGenerator: 'Autonomous PR Agent',
    branch: 'ai/sliding-refresh-grace-892',
    baseBranch: 'main',
    commitSha: '7e19b402',
    timestamp: '2026-10-15T14:05:00Z',
    description:
      'Introduces a 30-second network retry grace window during refresh token rotation so mobile clients on lossy connections do not trigger false family revocation.',
    filePath: 'auth/session_rotator.py',
    language: 'python',
    code: `from typing import Dict, Any, Optional

class SessionRotator:
    def __init__(self, grace_window_sec: int = 30, ttl_sec: int = 3600):
        self.grace_window_sec = grace_window_sec
        self.ttl_sec = ttl_sec
        self.tokens: Dict[str, Dict[str, Any]] = {}
        self.revoked_families: set = set()
        self._counter = 1000

    def issue_family(self, user_id: str, scope: str, now_ts: int) -> str:
        self._counter += 1
        token_id = f"rt_{self._counter}"
        self.tokens[token_id] = {
            "family_id": f"fam_{self._counter}",
            "user_id": user_id,
            "scope": scope,
            "issued_at": now_ts,
            "expires_at": now_ts + self.ttl_sec,
            "rotated_at": None,
            "replacement_token": None,
        }
        return token_id

    def rotate(self, token_id: str, now_ts: int, requested_scope: Optional[str] = None) -> Dict[str, Any]:
        record = self.tokens.get(token_id)
        if not record:
            raise ValueError("Unknown refresh token")

        family_id = record["family_id"]
        if family_id in self.revoked_families:
            raise PermissionError("Token family has been revoked")

        if now_ts >= record["expires_at"]:
            raise PermissionError("Refresh token expired")

        # Grace window check for already-rotated tokens
        if record["rotated_at"] is not None:
            if now_ts - record["rotated_at"] <= self.grace_window_sec:
                # BUG 1: Returns replacement token without checking if requested_scope escalated privileges
                return {"token": record["replacement_token"], "scope": requested_scope or record["scope"], "replayed": True}
            else:
                self.revoked_families.add(family_id)
                raise PermissionError("Token reuse detected outside grace window; family revoked")

        # BUG 2: Allows scope escalation on rotation when requested_scope is passed
        next_scope = requested_scope if requested_scope is not None else record["scope"]
        self._counter += 1
        new_token = f"rt_{self._counter}"
        self.tokens[new_token] = {
            "family_id": family_id,
            "user_id": record["user_id"],
            "scope": next_scope,
            "issued_at": now_ts,
            "expires_at": now_ts + self.ttl_sec,
            "rotated_at": None,
            "replacement_token": None,
        }
        record["rotated_at"] = now_ts
        record["replacement_token"] = new_token
        return {"token": new_token, "scope": next_scope, "replayed": False}
`,
    diff: `@@ -35,9 +35,16 @@ class SessionRotator:
         if record["rotated_at"] is not None:
-            self.revoked_families.add(family_id)
-            raise PermissionError("Refresh token reuse detected")
+            if now_ts - record["rotated_at"] <= self.grace_window_sec:
+                return {"token": record["replacement_token"], "scope": requested_scope or record["scope"], "replayed": True}
+            else:
+                self.revoked_families.add(family_id)
+                raise PermissionError("Token reuse detected outside grace window; family revoked")
 
+        next_scope = requested_scope if requested_scope is not None else record["scope"]
         self._counter += 1`
  }
];

export const INITIAL_VERIFICATION_REPORTS: Record<string, VerificationReport> = {
  'pr-escrow-settlement': {
    runId: 'vr-9f3c2a1b-01',
    prId: 'pr-escrow-settlement',
    verifiedAt: '2026-10-15T18:49:12Z',
    plannerModel: 'gemini-4-argon',
    attackerModel: 'gemini-flash-latest',
    sandboxAgent: 'antigravity-preview-09-2026',
    environmentId: 'env-ag-88412f90c',
    interactionId: 'int-ag-77291a3b4',
    invariants: [
      {
        id: 'INV-01',
        title: 'Strict Non-Negative Line-Item Payouts',
        category: 'security',
        formalProperty: '∀ item ∈ payouts: item["amount_cents"] > 0',
        targetSymbol: 'EscrowLedger.release_batch',
        rationale:
          'While sum(payouts) is checked against current_escrow, a negative payout item paired with a large positive payout passes the sum check and mints unbacked balance into another recipient account.',
        plannedAttackVector:
          'Submit a 2-item batch [{"recipient": "attacker", "amount_cents": 50000}, {"recipient": "drain", "amount_cents": -45000}] against a 10,000-cent escrow balance.'
      },
      {
        id: 'INV-02',
        title: 'Batch Atomicity on Mid-Loop Validation Failure',
        category: 'state',
        formalProperty: 'If release_batch() raises Exception, self.escrow_balances and self.recipient_balances remain identical to pre-call state',
        targetSymbol: 'EscrowLedger.release_batch',
        rationale:
          'State mutations happen inside the loop before validating all recipients. If item[1] has an empty recipient string, item[0] has already debited escrow and credited recipient[0] without rollback.',
        plannedAttackVector:
          'Pass valid item[0] followed by invalid item[1] (recipient="") and assert source_account escrow was not partially debited.'
      },
      {
        id: 'INV-03',
        title: 'Idempotency Key Payload Binding',
        category: 'regression',
        formalProperty: 'release_batch(k, P1) ∧ release_batch(k, P2) with P1 ≠ P2 ⇒ raises ValueError("Idempotency key payload mismatch")',
        targetSymbol: 'EscrowLedger.processed_batches',
        rationale:
          'Reusing an idempotency key with different payout parameters silently returns the cached receipt from the first batch without executing or alerting on parameter drift.',
        plannedAttackVector:
          'Call release_batch with key "idem-1" for 1,000 cents, then replay "idem-1" with a 9,000-cent payout payload and check if mismatch is detected.'
      },
      {
        id: 'INV-04',
        title: 'Exact Integer Basis-Point Conservation',
        category: 'edge_cases',
        formalProperty: 'escrow_before - escrow_after == sum(net_disbursed) + sum(fee_collected) ∧ fee == (gross * bps) // 10000',
        targetSymbol: 'EscrowLedger.release_batch',
        rationale:
          'Switching from integer floor division // 10000 to float round(gross * (bps / 10000.0)) introduces IEEE-754 banker rounding discrepancies on odd cent amounts.',
        plannedAttackVector:
          'Sweep odd prime cent amounts (e.g., 19 cents, 50 cents at 250 bps) and compare against deterministic integer floor basis-point calculation.'
      }
    ],
    tests: [
      {
        id: 'ATK-SEC-01',
        agent: 'security',
        invariantId: 'INV-01',
        name: 'test_negative_payout_item_mints_unbacked_funds',
        hypothesis: 'A negative payout entry offsets a massive positive payout entry so sum(payouts) <= escrow, minting unbacked money.',
        pythonTestCode: `def test_negative_payout_item_mints_unbacked_funds():
    ledger = EscrowLedger(platform_fee_bps=250)
    ledger.deposit("merchant_1", 1000)
    # Sum is 500 <= 1000, but attacker_acct receives 10,000 cents!
    payouts = [
        {"recipient": "attacker_acct", "amount_cents": 10000},
        {"recipient": " mule_acct", "amount_cents": -9500},
    ]
    try:
        ledger.release_batch("idem_neg", "merchant_1", payouts)
    except ValueError:
        return
    assert ledger.recipient_balances.get("attacker_acct", 0) <= 1000, (
        f"INV-01 VIOLATED: Attacker credited {ledger.recipient_balances.get('attacker_acct')} cents from 1000 cent escrow"
    )`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput:
          'AssertionError: INV-01 VIOLATED: Attacker credited 9750 cents from 1000 cent escrow (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'Critical',
        violatedLineRange: 'L44-L57',
        remediationHint: 'Validate every item["amount_cents"] > 0 before computing total_requested or mutating balances.'
      },
      {
        id: 'ATK-STATE-01',
        agent: 'state',
        invariantId: 'INV-02',
        name: 'test_partial_batch_failure_corrupts_escrow_state',
        hypothesis: 'When the second payout item raises ValueError for an empty recipient, the first payout item remains permanently debited.',
        pythonTestCode: `def test_partial_batch_failure_corrupts_escrow_state():
    ledger = EscrowLedger(platform_fee_bps=250)
    ledger.deposit("merchant_1", 5000)
    payouts = [
        {"recipient": "vendor_a", "amount_cents": 2000},
        {"recipient": "", "amount_cents": 1000},
    ]
    try:
        ledger.release_batch("idem_atomic", "merchant_1", payouts)
    except ValueError:
        pass
    assert ledger.escrow_balances["merchant_1"] == 5000, (
        f"INV-02 VIOLATED: Escrow partially debited to {ledger.escrow_balances['merchant_1']} after failed batch"
    )`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput:
          'AssertionError: INV-02 VIOLATED: Escrow partially debited to 3000 after failed batch (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'Critical',
        violatedLineRange: 'L45-L60',
        remediationHint: 'Pre-validate all payout items in a dry-run pass before mutating self.escrow_balances or self.recipient_balances.'
      },
      {
        id: 'ATK-REG-01',
        agent: 'regression',
        invariantId: 'INV-03',
        name: 'test_idempotency_key_collision_with_mutated_payload',
        hypothesis: 'Replaying the same idempotency_key with a different payout amount silently returns the first receipt instead of raising.',
        pythonTestCode: `def test_idempotency_key_collision_with_mutated_payload():
    ledger = EscrowLedger(platform_fee_bps=250)
    ledger.deposit("merchant_1", 10000)
    ledger.release_batch("idem_collision", "merchant_1", [{"recipient": "v1", "amount_cents": 1000}])
    # Second call uses same key but different recipient and amount
    res2 = ledger.release_batch("idem_collision", "merchant_1", [{"recipient": "v2", "amount_cents": 8000}])
    assert res2["gross_released"] == 8000, (
        f"INV-03 VIOLATED: Silent idempotency collision returned stale gross_released={res2['gross_released']}"
    )`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput:
          'AssertionError: INV-03 VIOLATED: Silent idempotency collision returned stale gross_released=1000 (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'High',
        violatedLineRange: 'L31-L32',
        remediationHint: 'Store a canonical SHA-256 fingerprint of (source_account, payouts) alongside idempotency_key and raise on mismatch.'
      },
      {
        id: 'ATK-EDGE-01',
        agent: 'edge_cases',
        invariantId: 'INV-04',
        name: 'test_basis_point_float_rounding_regression',
        hypothesis: 'Using float round() instead of integer floor division // 10000 alters fee deduction on half-cent boundaries (e.g. 20 cents at 250 bps).',
        pythonTestCode: `def test_basis_point_float_rounding_regression():
    ledger = EscrowLedger(platform_fee_bps=250)
    ledger.deposit("merchant_1", 1000)
    # 60 cents * 250 / 10000 = 1.5 cents -> integer floor // 10000 is 1 cent, round(1.5) is 2 cents
    res = ledger.release_batch("idem_rounding", "merchant_1", [{"recipient": "v1", "amount_cents": 60}])
    expected_floor_fee = (60 * 250) // 10000
    assert res["fee_collected"] == expected_floor_fee, (
        f"INV-04 VIOLATED: Fee drift got {res['fee_collected']} cent(s), expected integer floor {expected_floor_fee}"
    )`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput:
          'AssertionError: INV-04 VIOLATED: Fee drift got 2 cent(s), expected integer floor 1 (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'Medium',
        violatedLineRange: 'L48-L49',
        remediationHint: 'Replace int(round(gross * (self.platform_fee_bps / 10000.0))) with integer arithmetic (gross * self.platform_fee_bps) // 10000.'
      },
      {
        id: 'ATK-SEC-02',
        agent: 'security',
        invariantId: 'INV-01',
        name: 'test_unauthorized_actor_role_rejected',
        hypothesis: 'Verify that non-whitelisted actor_role strings raise PermissionError before any balance lookup.',
        pythonTestCode: `def test_unauthorized_actor_role_rejected():
    ledger = EscrowLedger()
    ledger.deposit("merchant_1", 1000)
    try:
        ledger.release_batch("idem_auth", "merchant_1", [{"recipient": "v1", "amount_cents": 100}], actor_role="guest")
        assert False, "Expected PermissionError"
    except PermissionError:
        assert True`,
        run1Status: 'PASS',
        run2Status: 'PASS',
        reproducedTwice: false,
        failureOutput: 'Test passed in 2/2 runs (invariant held against attack).',
        severity: 'High',
        violatedLineRange: 'L34-L35',
        remediationHint: 'None required; role whitelist check held.'
      },
      {
        id: 'ATK-STATE-02',
        agent: 'state',
        invariantId: 'INV-02',
        name: 'test_randomized_hash_order_timing_probe',
        hypothesis: 'Probes dictionary iteration timing variance across 50,000 synthetic keys under CPU contention.',
        pythonTestCode: `def test_randomized_hash_order_timing_probe():
    # Non-deterministic timing assertion quarantined by 2x reproduction filter
    pass`,
        run1Status: 'FLAKY_ERROR',
        run2Status: 'PASS',
        reproducedTwice: false,
        failureOutput:
          'Quarantined by 2x Repro Gate: Failed in Run #1 (14.2ms > 12.0ms threshold), Passed in Run #2 (8.9ms). Excluded from reported findings.',
        severity: 'Medium',
        violatedLineRange: 'L28-L32',
        remediationHint: 'Suppressed automatically — did not reproduce across both isolated sandbox runs.'
      }
    ],
    reproducibleFailures: [],
    quarantinedFlakes: [],
    plantedBugs: [
      {
        id: 'MUT-01',
        name: 'Off-by-One Overdraft Boundary (< vs <=)',
        category: 'edge_cases',
        description: 'Mutated `if total_requested > current_escrow` to `if total_requested > current_escrow + 1`, allowing 1-cent overdraft.',
        originalSnippet: 'if total_requested > current_escrow:',
        mutatedSnippet: 'if total_requested > current_escrow + 1:',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught deterministically by exact boundary sweep test.'
      },
      {
        id: 'MUT-02',
        name: 'Role Whitelist Bypass Mutation',
        category: 'security',
        description: 'Removed `actor_role` check in `release_batch` to test whether attacker swarm verifies access control.',
        originalSnippet: 'if actor_role not in ("operator", "settlement_admin", "system"):\n    raise PermissionError("Unauthorized actor role")',
        mutatedSnippet: '# role check omitted in mutant copy',
        caught: true,
        caughtByTestId: 'ATK-SEC-02',
        caughtByAgent: 'security',
        blindSpotAnalysis: 'Caught deterministically by Security Agent role-escalation probe.'
      },
      {
        id: 'MUT-03',
        name: 'Double Escrow Debit Per Payout Item',
        category: 'state',
        description: 'Changed `self.escrow_balances[source_account] -= gross` to `self.escrow_balances[source_account] -= (gross + fee)`.',
        originalSnippet: 'self.escrow_balances[source_account] -= gross',
        mutatedSnippet: 'self.escrow_balances[source_account] -= (gross + fee)',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught by conservation-of-funds assertion on remaining_escrow.'
      },
      {
        id: 'MUT-04',
        name: 'Swapped Net and Fee Treasury Crediting',
        category: 'regression',
        description: 'Credited `fee` to recipient and `net` to `platform_treasury`.',
        originalSnippet: 'self.recipient_balances[recipient] = self.recipient_balances.get(recipient, 0) + net',
        mutatedSnippet: 'self.recipient_balances[recipient] = self.recipient_balances.get(recipient, 0) + fee',
        caught: true,
        caughtByTestId: 'ATK-SEC-01',
        caughtByAgent: 'security',
        blindSpotAnalysis: 'Caught by recipient balance verification.'
      },
      {
        id: 'MUT-05',
        name: 'Disabled Idempotency Cache Write',
        category: 'state',
        description: 'Omitted `self.processed_batches[idempotency_key] = result` so duplicate retries double-charge escrow.',
        originalSnippet: 'self.processed_batches[idempotency_key] = result',
        mutatedSnippet: '# idempotency store skipped in mutant',
        caught: true,
        caughtByTestId: 'ATK-REG-01',
        caughtByAgent: 'regression',
        blindSpotAnalysis: 'Caught by replay test verifying idempotency cache behavior.'
      },
      {
        id: 'MUT-06',
        name: 'Zero-Deposit Guard Removal',
        category: 'edge_cases',
        description: 'Relaxed `if amount_cents <= 0` in `deposit()` to allow zero-cent no-op deposits.',
        originalSnippet: 'if amount_cents <= 0:',
        mutatedSnippet: 'if amount_cents < 0:',
        caught: true,
        caughtByTestId: 'ATK-SEC-01',
        caughtByAgent: 'security',
        blindSpotAnalysis: 'Caught by input domain boundary assertions.'
      },
      {
        id: 'MUT-07',
        name: 'Empty Recipient Validation Omission',
        category: 'state',
        description: 'Removed `if not recipient` guard inside loop.',
        originalSnippet: 'if not recipient or not isinstance(recipient, str):',
        mutatedSnippet: 'if False:',
        caught: true,
        caughtByTestId: 'ATK-STATE-01',
        caughtByAgent: 'state',
        blindSpotAnalysis: 'Caught by State Agent invalid-recipient rollback test.'
      },
      {
        id: 'MUT-08',
        name: 'Audit Log Silent Drop on Replay',
        category: 'regression',
        description: 'Mutated `self.audit_log.append(result)` to store a shallow mutable reference that gets overwritten on subsequent calls.',
        originalSnippet: 'self.audit_log.append(result)',
        mutatedSnippet: 'self.audit_log.clear(); self.audit_log.append(result)',
        caught: false,
        caughtByTestId: null,
        caughtByAgent: null,
        blindSpotAnalysis:
          'SURVIVED MUTANT: None of the 4 attacker agents asserted multi-batch historical length on `self.audit_log`. Logged as Residual Risk RR-01.'
      }
    ],
    plantedBugsCaught: 7,
    plantedBugsTotal: 8,
    detectionScorePct: 87.5,
    residualRisks: [
      {
        id: 'RR-01',
        title: 'Append-Only Audit Log Tamper / Truncation Blind Spot',
        source: 'Uncaught Planted Bug MUT-08 (1 of 8 planted bugs survived)',
        impact:
          'While balance invariants and idempotency collisions were thoroughly tested, the attacker swarm did not assert multi-transaction retention in `self.audit_log`.',
        recommendation:
          'Add an invariant assertion verifying `len(ledger.audit_log)` increments monotonically across distinct `idempotency_key` batches.'
      },
      {
        id: 'RR-02',
        title: 'Multi-Process Distributed Lock Contention Not Simulated',
        source: 'Single-Process Memory Model Scope',
        impact:
          'In-memory dict checks (`idempotency_key in self.processed_batches`) are verified in single-process Python execution but require SELECT FOR UPDATE in production PostgreSQL.',
        recommendation: 'Ensure database-level unique constraint on `idempotency_key` before merging to production.'
      }
    ],
    executiveSummary:
      'Reject merge recommended. Gemini 4 Argon extracted 4 formal invariants and dispatched 4 parallel Gemini Flash attacker agents. In isolated Antigravity sandbox execution, 4 breaking tests failed deterministically across 2 of 2 runs (including a critical negative line-item money-minting exploit and mid-batch partial state corruption). 1 flaky timing failure (1/2 runs) was quarantined. Verifier calibration caught 7 of 8 planted bugs (87.5% detection score), exposing 1 residual blind spot around `audit_log` retention.',
    recommendedAction: 'REJECT_MERGE',
    sandboxSteps: [
      {
        index: 1,
        type: 'thought',
        timestamp: '18:48:51.104',
        summary: 'Provisioning isolated Linux sandbox workspace and writing candidate PR module `escrow_ledger.py` plus 6 attacker test suites.',
        detail: 'Planning 2-pass deterministic execution harness (Run #1 and Run #2 with randomized seed isolation) followed by 8 planted bug mutant runs.'
      },
      {
        index: 2,
        type: 'code_execution_call',
        timestamp: '18:48:54.320',
        summary: 'Executing Pass #1 and Pass #2 against candidate PR code in `/workspace/sandbox_run.py`',
        detail: 'python3 /workspace/sandbox_run.py --mode=double-repro --target=escrow_ledger.py'
      },
      {
        index: 3,
        type: 'code_execution_result',
        timestamp: '18:49:01.882',
        summary: 'Pass #1: 5 failures, 1 pass. Pass #2: 4 failures reproduced (2/2), 1 flake filtered (1/2).',
        detail:
          'REPRODUCED (2/2): ATK-SEC-01 (negative payout mints 9750c), ATK-STATE-01 (partial batch state corruption), ATK-REG-01 (idempotency payload collision), ATK-EDGE-01 (float round fee drift).\nQUARANTINED (1/2): ATK-STATE-02 (hash timing probe failed run 1, passed run 2).'
      },
      {
        index: 4,
        type: 'code_execution_call',
        timestamp: '18:49:04.115',
        summary: 'Running Verifier Calibration Suite against 8 planted bug copies (`MUT-01` .. `MUT-08`)',
        detail: 'python3 /workspace/sandbox_run.py --mode=mutation-calibration --mutants=8'
      },
      {
        index: 5,
        type: 'code_execution_result',
        timestamp: '18:49:09.640',
        summary: 'Calibration Score: 7 of 8 planted bugs caught (87.5%). Surviving mutant: MUT-08 (audit_log truncation).',
        detail: 'Caught: MUT-01, MUT-02, MUT-03, MUT-04, MUT-05, MUT-06, MUT-07. Escaped: MUT-08.'
      },
      {
        index: 6,
        type: 'model_output',
        timestamp: '18:49:12.005',
        summary: 'Completed sandbox verification report generation with reproducible stack traces and mutation matrix.'
      }
    ]
  },
  'pr-token-bucket': {
    runId: 'vr-4d81e07c-01',
    prId: 'pr-token-bucket',
    verifiedAt: '2026-10-15T18:30:04Z',
    plannerModel: 'gemini-4-argon',
    attackerModel: 'gemini-flash-latest',
    sandboxAgent: 'antigravity-preview-09-2026',
    environmentId: 'env-ag-39104c12e',
    interactionId: 'int-ag-55109f2a1',
    invariants: [
      {
        id: 'INV-01',
        title: 'Positive Token Consumption Cost Enforcement',
        category: 'security',
        formalProperty: '∀ cost ≤ 0: consume(tenant_id, cost, now_ts) raises ValueError',
        targetSymbol: 'TenantRateLimiter.consume',
        rationale: 'The PR diff removed `if cost <= 0: raise ValueError`, allowing negative `cost` values to mint tokens and bypass rate limits.',
        plannedAttackVector: 'Invoke consume(tenant_id="t1", cost=-500, now_ts=100.0) and inspect remaining bucket balance.'
      },
      {
        id: 'INV-02',
        title: 'Monotonic Clock Skew Resilience',
        category: 'edge_cases',
        formalProperty: 'now_ts < bucket["last_ts"] ⇒ refilled == 0 ∧ bucket["last_ts"] unchanged',
        targetSymbol: 'TenantRateLimiter.consume',
        rationale: 'NTP clock rollback makes `elapsed = now_ts - bucket["last_ts"]` negative, draining tenant tokens unfairly.',
        plannedAttackVector: 'Call consume at now_ts=200.0 then at now_ts=190.0 and assert tokens do not decrease beyond cost.'
      },
      {
        id: 'INV-03',
        title: 'Shared Reserve Pool Non-Negativity & Borrow Accounting',
        category: 'state',
        formalProperty: 'self.shared_reserve ≥ 0 ∧ int(cost - bucket["tokens"]) >= cost - bucket["tokens"]',
        targetSymbol: 'TenantRateLimiter.consume',
        rationale: 'Truncating float `int(cost - bucket["tokens"])` when `tokens` has fractional refill under-charges `shared_reserve` by up to 0.999 tokens per borrow.',
        plannedAttackVector: 'Refill 0.9 tokens via fractional timestamp, then borrow against shared_reserve and check exact deficit.'
      },
      {
        id: 'INV-04',
        title: 'Borrowed Debt Repayment Before Refill Accumulation',
        category: 'regression',
        formalProperty: 'If bucket["borrowed"] > 0, subsequent refill repays shared_reserve before crediting tenant bucket',
        targetSymbol: 'TenantRateLimiter.consume',
        rationale: 'Tenants borrow from `shared_reserve` during bursts, but subsequent refills credit the tenant bucket without ever replenishing `shared_reserve`.',
        plannedAttackVector: 'Exhaust shared_reserve via repeated burst borrows followed by idle refill intervals.'
      }
    ],
    tests: [
      {
        id: 'ATK-SEC-01',
        agent: 'security',
        invariantId: 'INV-01',
        name: 'test_negative_cost_mints_unlimited_tokens',
        hypothesis: 'Passing a negative cost subtracts a negative number from bucket["tokens"], inflating quota above capacity.',
        pythonTestCode: `def test_negative_cost_mints_unlimited_tokens():
    limiter = TenantRateLimiter(default_capacity=100)
    res = limiter.consume("tenant_a", cost=-900, now_ts=10.0)
    assert res["remaining"] <= 100, f"INV-01 VIOLATED: Negative cost minted {res['remaining']} tokens"`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput: 'AssertionError: INV-01 VIOLATED: Negative cost minted 1000.0 tokens (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'Critical',
        violatedLineRange: 'L25-L27',
        remediationHint: 'Restore `if cost <= 0: raise ValueError("Cost must be positive")` at the start of consume().'
      },
      {
        id: 'ATK-EDGE-01',
        agent: 'edge_cases',
        invariantId: 'INV-02',
        name: 'test_ntp_backward_clock_skew_drains_bucket',
        hypothesis: 'When now_ts < last_ts due to NTP adjustment, negative elapsed time penalizes the tenant bucket.',
        pythonTestCode: `def test_ntp_backward_clock_skew_drains_bucket():
    limiter = TenantRateLimiter(default_capacity=100, refill_per_sec=10.0)
    limiter.consume("tenant_a", cost=10, now_ts=100.0)
    res = limiter.consume("tenant_a", cost=10, now_ts=95.0)
    assert res["remaining"] == 80.0, f"INV-02 VIOLATED: Backward clock skew drained tokens to {res['remaining']}"`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput: 'AssertionError: INV-02 VIOLATED: Backward clock skew drained tokens to 30.0 (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'High',
        violatedLineRange: 'L19-L22',
        remediationHint: 'Clamp elapsed time with `elapsed = max(0.0, now_ts - bucket["last_ts"])` and only advance last_ts monotonically.'
      },
      {
        id: 'ATK-REG-01',
        agent: 'regression',
        invariantId: 'INV-04',
        name: 'test_shared_reserve_permanent_depletion_after_refill',
        hypothesis: 'Borrowed tokens are never repaid to shared_reserve when the tenant bucket refills.',
        pythonTestCode: `def test_shared_reserve_permanent_depletion_after_refill():
    limiter = TenantRateLimiter(default_capacity=100, refill_per_sec=100.0, shared_reserve=50)
    limiter.consume("tenant_a", cost=150, now_ts=1.0, allow_borrow=True)
    limiter.consume("tenant_a", cost=10, now_ts=10.0, allow_borrow=False)
    assert limiter.shared_reserve == 50, f"INV-04 VIOLATED: shared_reserve stuck at {limiter.shared_reserve}"`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput: 'AssertionError: INV-04 VIOLATED: shared_reserve stuck at 0 (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'High',
        violatedLineRange: 'L28-L35',
        remediationHint: 'Deduct refilled tokens to repay `bucket["borrowed"]` and credit `self.shared_reserve` before increasing `bucket["tokens"]`.'
      }
    ],
    reproducibleFailures: [],
    quarantinedFlakes: [],
    plantedBugs: [
      {
        id: 'MUT-01',
        name: 'Capacity Clamp Inversion (max vs min)',
        category: 'edge_cases',
        description: 'Changed `min(float(self.default_capacity), ...)` to `max(...)`.',
        originalSnippet: 'bucket["tokens"] = min(float(self.default_capacity), bucket["tokens"] + refilled)',
        mutatedSnippet: 'bucket["tokens"] = max(float(self.default_capacity), bucket["tokens"] + refilled)',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught deterministically in sandbox.'
      },
      {
        id: 'MUT-02',
        name: 'Unconditional Borrow Flag Enablement',
        category: 'security',
        description: 'Mutated `if allow_borrow:` to `if True:`.',
        originalSnippet: 'if allow_borrow:',
        mutatedSnippet: 'if True:',
        caught: true,
        caughtByTestId: 'ATK-REG-01',
        caughtByAgent: 'regression',
        blindSpotAnalysis: 'Caught by non-borrowing quota test.'
      },
      {
        id: 'MUT-03',
        name: 'Reserve Credit Instead of Debit on Borrow',
        category: 'state',
        description: 'Mutated `self.shared_reserve -= deficit` to `+= deficit`.',
        originalSnippet: 'self.shared_reserve -= deficit',
        mutatedSnippet: 'self.shared_reserve += deficit',
        caught: true,
        caughtByTestId: 'ATK-REG-01',
        caughtByAgent: 'regression',
        blindSpotAnalysis: 'Caught by reserve pool conservation check.'
      },
      {
        id: 'MUT-04',
        name: 'Missing Token Deduction on Standard Consume',
        category: 'security',
        description: 'Omitted `bucket["tokens"] -= cost`.',
        originalSnippet: 'bucket["tokens"] -= cost',
        mutatedSnippet: '# token deduction removed',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught by sequential consumption test.'
      },
      {
        id: 'MUT-05',
        name: 'Zero Refill Rate Multiplier',
        category: 'regression',
        description: 'Mutated `refilled = elapsed * self.refill_per_sec` to `0.0`.',
        originalSnippet: 'refilled = elapsed * self.refill_per_sec',
        mutatedSnippet: 'refilled = 0.0',
        caught: true,
        caughtByTestId: 'ATK-REG-01',
        caughtByAgent: 'regression',
        blindSpotAnalysis: 'Caught by time-advance refill check.'
      },
      {
        id: 'MUT-06',
        name: 'Off-by-One Token Sufficiency Check (> vs >=)',
        category: 'edge_cases',
        description: 'Changed `if bucket["tokens"] >= cost:` to `>`.',
        originalSnippet: 'if bucket["tokens"] >= cost:',
        mutatedSnippet: 'if bucket["tokens"] > cost:',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught by exact capacity exhaustion boundary test.'
      },
      {
        id: 'MUT-07',
        name: 'Stale Timestamp Persistence',
        category: 'state',
        description: 'Removed `bucket["last_ts"] = now_ts`.',
        originalSnippet: 'bucket["last_ts"] = now_ts',
        mutatedSnippet: '# timestamp update omitted',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught by multi-step timestamp progression.'
      },
      {
        id: 'MUT-08',
        name: 'Unbounded Tenant Dictionary Memory Growth',
        category: 'state',
        description: 'Removed idle tenant eviction hook on 100k ephemeral tenant IDs.',
        originalSnippet: 'self.buckets[tenant_id] = {',
        mutatedSnippet: 'self.buckets[tenant_id] = { "_pinned": True,',
        caught: false,
        caughtByTestId: null,
        caughtByAgent: null,
        blindSpotAnalysis: 'SURVIVED MUTANT: Attacker swarm did not assert memory cap across high-cardinality tenant churn.'
      }
    ],
    plantedBugsCaught: 7,
    plantedBugsTotal: 8,
    detectionScorePct: 87.5,
    residualRisks: [
      {
        id: 'RR-01',
        title: 'High-Cardinality Tenant Bucket Memory Exhaustion',
        source: 'Uncaught Planted Bug MUT-08 (1 of 8 planted bugs survived)',
        impact: 'Unauthenticated callers spoofing random tenant_id strings can grow `self.buckets` without bound.',
        recommendation: 'Add LRU eviction or max-tenant cap before merging.'
      }
    ],
    executiveSummary:
      'Reject merge recommended. 3 breaking tests failed reproducibly (2/2 runs) in Antigravity sandbox, uncovering a critical negative-cost quota inflation bug removed in the diff, NTP backward clock-skew token drain, and permanent depletion of `shared_reserve`. Verifier calibration caught 7 of 8 planted bugs (87.5%).',
    recommendedAction: 'REJECT_MERGE',
    sandboxSteps: [
      {
        index: 1,
        type: 'thought',
        timestamp: '18:29:49.012',
        summary: 'Initializing isolated Antigravity sandbox for `token_bucket.py` verification and 8-mutant calibration.'
      },
      {
        index: 2,
        type: 'code_execution_call',
        timestamp: '18:29:53.400',
        summary: 'Running 2-pass reproduction harness against `TenantRateLimiter`'
      },
      {
        index: 3,
        type: 'code_execution_result',
        timestamp: '18:30:01.118',
        summary: '3 of 3 failures reproduced deterministically across both runs; 7 of 8 planted bugs caught.'
      }
    ]
  },
  'pr-jwt-session-rotator': {
    runId: 'vr-7e19b402-01',
    prId: 'pr-jwt-session-rotator',
    verifiedAt: '2026-10-15T18:15:40Z',
    plannerModel: 'gemini-4-argon',
    attackerModel: 'gemini-flash-latest',
    sandboxAgent: 'antigravity-preview-09-2026',
    environmentId: 'env-ag-99201b44d',
    interactionId: 'int-ag-11842e9c0',
    invariants: [
      {
        id: 'INV-01',
        title: 'Scope Attenuation Only (No Privilege Escalation on Rotation)',
        category: 'security',
        formalProperty: 'rotate(token, now, requested_scope) ⇒ new_scope ⊆ original_token.scope',
        targetSymbol: 'SessionRotator.rotate',
        rationale: 'Passing `requested_scope="admin:all"` during refresh rotation overwrites `record["scope"]` without checking if it is a subset of the original scope.',
        plannedAttackVector: 'Issue a "read:profile" token, call rotate() with requested_scope="root:admin", and assert PermissionError.'
      },
      {
        id: 'INV-02',
        title: 'Grace Window Replay Immutability & Non-Negative Elapsed Time',
        category: 'edge_cases',
        formalProperty: '0 ≤ now_ts - record["rotated_at"] ≤ grace_window_sec ∧ replayed response scope == replacement_token.scope',
        targetSymbol: 'SessionRotator.rotate',
        rationale: 'During the 30s grace window, replaying a rotated token with a forged `requested_scope` returns the forged scope in the response dict.',
        plannedAttackVector: 'Rotate a token once, then replay within 10s with `requested_scope="admin"` and inspect returned scope.'
      }
    ],
    tests: [
      {
        id: 'ATK-SEC-01',
        agent: 'security',
        invariantId: 'INV-01',
        name: 'test_privilege_escalation_via_requested_scope_on_rotate',
        hypothesis: 'An unprivileged refresh token can escalate to admin scope during standard token rotation.',
        pythonTestCode: `def test_privilege_escalation_via_requested_scope_on_rotate():
    rotator = SessionRotator()
    t1 = rotator.issue_family("user_42", scope="read:own", now_ts=1000)
    res = rotator.rotate(t1, now_ts=1010, requested_scope="admin:full")
    assert res["scope"] == "read:own", f"INV-01 VIOLATED: Escalated from read:own to {res['scope']}"`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput: 'AssertionError: INV-01 VIOLATED: Escalated from read:own to admin:full (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'Critical',
        violatedLineRange: 'L44-L53',
        remediationHint: 'Verify that `requested_scope` is a strict subset of `record["scope"]` or reject scope overrides during refresh rotation.'
      },
      {
        id: 'ATK-EDGE-01',
        agent: 'edge_cases',
        invariantId: 'INV-02',
        name: 'test_grace_window_replay_spoofs_returned_scope',
        hypothesis: 'Replaying an already-rotated token inside the 30s grace window returns `requested_scope` unvalidated.',
        pythonTestCode: `def test_grace_window_replay_spoofs_returned_scope():
    rotator = SessionRotator(grace_window_sec=30)
    t1 = rotator.issue_family("user_42", scope="read:own", now_ts=1000)
    rotator.rotate(t1, now_ts=1005)
    replay = rotator.rotate(t1, now_ts=1015, requested_scope="superuser")
    assert replay["scope"] == "read:own", f"INV-02 VIOLATED: Grace replay returned spoofed scope {replay['scope']}"`,
        run1Status: 'FAIL',
        run2Status: 'FAIL',
        reproducedTwice: true,
        failureOutput: 'AssertionError: INV-02 VIOLATED: Grace replay returned spoofed scope superuser (reproduced 2/2 runs in Antigravity sandbox)',
        severity: 'Critical',
        violatedLineRange: 'L37-L39',
        remediationHint: 'Return the immutable scope bound to `record["replacement_token"]` on grace-window replay.'
      }
    ],
    reproducibleFailures: [],
    quarantinedFlakes: [],
    plantedBugs: [
      {
        id: 'MUT-01',
        name: 'Disabled Family Revocation Set Addition',
        category: 'security',
        description: 'Removed `self.revoked_families.add(family_id)` when reuse occurs outside grace window.',
        originalSnippet: 'self.revoked_families.add(family_id)',
        mutatedSnippet: '# revocation skipped',
        caught: true,
        caughtByTestId: 'ATK-SEC-01',
        caughtByAgent: 'security',
        blindSpotAnalysis: 'Caught by token family revocation test.'
      },
      {
        id: 'MUT-02',
        name: 'Expiration Boundary Inversion',
        category: 'edge_cases',
        description: 'Changed `if now_ts >= record["expires_at"]:` to `if now_ts > record["expires_at"] + 3600:`.',
        originalSnippet: 'if now_ts >= record["expires_at"]:',
        mutatedSnippet: 'if now_ts > record["expires_at"] + 3600:',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught by TTL expiry boundary check.'
      },
      {
        id: 'MUT-03',
        name: 'Infinite Grace Window Mutation',
        category: 'security',
        description: 'Changed `<= self.grace_window_sec` to `<= 999999`.',
        originalSnippet: 'if now_ts - record["rotated_at"] <= self.grace_window_sec:',
        mutatedSnippet: 'if now_ts - record["rotated_at"] <= 999999:',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught by post-grace-window theft detection test.'
      },
      {
        id: 'MUT-04',
        name: 'Missing rotated_at Timestamp Recording',
        category: 'state',
        description: 'Omitted `record["rotated_at"] = now_ts` after rotation.',
        originalSnippet: 'record["rotated_at"] = now_ts',
        mutatedSnippet: 'record["rotated_at"] = None',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught by replay detection assertion.'
      },
      {
        id: 'MUT-05',
        name: 'Broken Family ID Lineage on Child Token',
        category: 'regression',
        description: 'Assigned a fresh `family_id` on rotation so revoking the family leaves child tokens active.',
        originalSnippet: '"family_id": family_id,',
        mutatedSnippet: '"family_id": "detached_family",',
        caught: true,
        caughtByTestId: 'ATK-SEC-01',
        caughtByAgent: 'security',
        blindSpotAnalysis: 'Caught by family lineage revocation test.'
      },
      {
        id: 'MUT-06',
        name: 'Revoked Family Check Bypass',
        category: 'security',
        description: 'Removed `if family_id in self.revoked_families:`.',
        originalSnippet: 'if family_id in self.revoked_families:',
        mutatedSnippet: 'if False:',
        caught: true,
        caughtByTestId: 'ATK-SEC-01',
        caughtByAgent: 'security',
        blindSpotAnalysis: 'Caught by security revocation check.'
      },
      {
        id: 'MUT-07',
        name: 'Null Replacement Token Return on Grace Replay',
        category: 'regression',
        description: 'Returned `None` instead of `record["replacement_token"]` during grace window.',
        originalSnippet: 'return {"token": record["replacement_token"],',
        mutatedSnippet: 'return {"token": None,',
        caught: true,
        caughtByTestId: 'ATK-EDGE-01',
        caughtByAgent: 'edge_cases',
        blindSpotAnalysis: 'Caught by grace-window contract check.'
      },
      {
        id: 'MUT-08',
        name: 'Predictable Sequential Counter Token IDs',
        category: 'security',
        description: 'Uses sequential `rt_1001`, `rt_1002` instead of CSPRNG `secrets.token_urlsafe(32)`.',
        originalSnippet: 'self._counter += 1\ntoken_id = f"rt_{self._counter}"',
        mutatedSnippet: 'self._counter += 1\ntoken_id = f"rt_{self._counter}"',
        caught: true,
        caughtByTestId: 'ATK-SEC-01',
        caughtByAgent: 'security',
        blindSpotAnalysis: 'Caught by token entropy check.'
      }
    ],
    plantedBugsCaught: 8,
    plantedBugsTotal: 8,
    detectionScorePct: 100.0,
    residualRisks: [
      {
        id: 'RR-01',
        title: 'Sequential Counter Token IDs in Candidate Implementation',
        source: 'Architectural Entropy Review',
        impact: 'Token IDs use a deterministic integer counter (`rt_1001`) which allows enumeration if not wrapped in a signed JWT.',
        recommendation: 'Replace counter with `secrets.token_urlsafe(32)` before merging.'
      }
    ],
    executiveSummary:
      'Reject merge recommended. 2 critical privilege-escalation vulnerabilities reproduced 2/2 times in Antigravity sandbox. Verifier calibration caught 8 of 8 planted bugs (100.0% detection score).',
    recommendedAction: 'REJECT_MERGE',
    sandboxSteps: [
      {
        index: 1,
        type: 'thought',
        timestamp: '18:15:22.100',
        summary: 'Provisioning Antigravity sandbox to verify `session_rotator.py` and run 8 planted bug mutants.'
      },
      {
        index: 2,
        type: 'code_execution_result',
        timestamp: '18:15:39.410',
        summary: '2 of 2 privilege escalation tests failed reproducibly (2/2 runs). 8 of 8 planted bugs caught.'
      }
    ]
  }
};

// Populate derived arrays for all initial reports
Object.values(INITIAL_VERIFICATION_REPORTS).forEach((rep) => {
  rep.reproducibleFailures = rep.tests.filter((t) => t.reproducedTwice);
  rep.quarantinedFlakes = rep.tests.filter(
    (t) => !t.reproducedTwice && (t.run1Status !== 'PASS' || t.run2Status !== 'PASS')
  );
});

