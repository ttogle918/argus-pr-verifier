"""
Workspace Import Graph Slicer for Argus-PR (`SPARSE_PACKAGE_TREE` & Frontend Page Slicing).

Solves the IDE / Full-Repo Verification Challenge:
- When a user opens an entire repository (like in VSCode or `secureai-editor`), booting a full
  frontend dev server (Next.js / Vite / Webpack) or mounting 500+ repo files into a sandbox is slow and noisy.
- Instead, given an entry file (e.g. `src/pages/RefundCheckoutPage.tsx` or `app/api/refund_router.py`),
  this module statically traces the local import graph (ESModule `import ... from`, CommonJS `require()`,
  dynamic `import()`, and Python `import` / `from ... import`) up to `max_depth`.
- Resolves relative paths (`./`, `../`), TypeScript/Vite alias paths (`@/`), and index files
  (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`), while filtering out external `node_modules` / PyPI packages
  and heavy lockfiles.
- Produces a compact `WorkspaceSliceResult` containing:
  1. `mounted_files`: Ordered list of resolved dependent files in the import closure
  2. `dependency_edges`: Directed edges `[{"from": ..., "to": ..., "import_spec": ...}]`
  3. `external_packages`: Third-party libraries detected (skipped from file mounting)
  4. `bundled_code_context`: Concatenated source bundle ready for Stage 0 Guardrail, Invariant Extraction,
     and Sandbox Verification without booting a heavyweight frontend server.
"""

from __future__ import annotations

import ast
import pathlib
import re
from typing import Dict, List, Literal, Optional, Set, Tuple
from pydantic import BaseModel, Field

from backend.models import ScopeTriageResult


# ==============================================================================
# DATA MODELS FOR WORKSPACE IMPORT GRAPH SLICER
# ==============================================================================

class ImportDependencyEdge(BaseModel):
    source_file: str = Field(description="Importing file path (relative to workspace root).")
    target_file: str = Field(description="Resolved local file path in the workspace.")
    raw_import_spec: str = Field(description="Original import specifier, e.g. '../utils/currency' or '@/api/ledgerClient'.")
    depth: int = Field(description="Hop distance from the entry file (1 = direct import).")


class WorkspaceSliceResult(BaseModel):
    entry_file: str = Field(description="Entry page, component, or backend route file selected for verification.")
    language_ecosystem: Literal["typescript_react", "python", "mixed"] = Field(
        description="Detected language ecosystem of the entry slice."
    )
    requires_live_server_dast: bool = Field(
        default=False,
        description="False for frontend/UI import slices (static + unit harness); True if backend HTTP daemon routes are detected.",
    )
    max_depth: int = Field(default=3, description="Maximum import traversal depth.")
    mounted_files: List[str] = Field(
        default_factory=list,
        description="Minimal closure of local files reachable from entry_file via imports.",
    )
    dependency_edges: List[ImportDependencyEdge] = Field(
        default_factory=list,
        description="Directed import graph edges traced from entry_file.",
    )
    external_packages: List[str] = Field(
        default_factory=list,
        description="External npm/PyPI packages referenced (excluded from local file slice).",
    )
    unresolved_imports: List[str] = Field(
        default_factory=list,
        description="Local-looking imports that could not be matched to a file in the workspace.",
    )
    skipped_heavy_paths: List[str] = Field(
        default_factory=list,
        description="Heavy workspace files/directories skipped (node_modules, lockfiles, build artifacts, unrelated pages).",
    )
    total_workspace_files: int = Field(default=0, description="Total files in the full repository/workspace before slicing.")
    sliced_file_count: int = Field(default=0, description="Number of files kept in the slice.")
    context_reduction_pct: float = Field(
        default=0.0,
        description="Percentage of repository files pruned by import-graph slicing.",
    )
    estimated_mount_size_kb: float = Field(default=0.0, description="Total size of mounted slice in KB.")
    bundled_code_context: str = Field(
        default="",
        description="Combined multi-file code context formatted for Argus-PR Stage 0..5 verification.",
    )
    scope_triage: ScopeTriageResult = Field(
        description="Stage 0.5 ScopeTriageResult automatically populated from this import graph slice."
    )


# ==============================================================================
# REGEX & AST IMPORT PARSERS (JS/TS/JSX/TSX & PYTHON)
# ==============================================================================

# Matches:
#   import Foo from './Foo'
#   import { a, b } from "../utils/auth"
#   export { x } from '@/components/Button'
#   import './styles.css'
_JS_STATIC_IMPORT_RE = re.compile(
    r"""(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]""",
    re.MULTILINE,
)

# Matches:
#   require('./helper')
#   import('./lazyModal')
_JS_DYNAMIC_IMPORT_RE = re.compile(
    r"""(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)""",
    re.MULTILINE,
)

_HEAVY_IGNORE_PREFIXES = (
    "node_modules/",
    ".git/",
    ".next/",
    "dist/",
    "build/",
    "coverage/",
    "__pycache__/",
    ".venv/",
    "venv/",
)

_HEAVY_IGNORE_FILENAMES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "poetry.lock",
    "uv.lock",
    "Cargo.lock",
}

_RESOLVABLE_EXTENSIONS = (
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".py",
    "/index.ts",
    "/index.tsx",
    "/index.js",
    "/index.jsx",
    "/__init__.py",
)


def _normalize_rel_path(path_str: str) -> str:
    """Normalizes slashes and strips leading './'."""
    cleaned = path_str.replace("\\", "/").strip()
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned.lstrip("/")


def extract_js_ts_imports(source_code: str) -> List[str]:
    """Extracts all static and dynamic import specifiers from JS/TS/JSX/TSX code."""
    specs: List[str] = []
    # Strip multi-line comments to avoid false matches in commented-out code
    clean_code = re.sub(r"/\*[\s\S]*?\*/", "", source_code)
    for match in _JS_STATIC_IMPORT_RE.finditer(clean_code):
        spec = match.group(1).strip()
        if spec and spec not in specs:
            specs.append(spec)
    for match in _JS_DYNAMIC_IMPORT_RE.finditer(clean_code):
        spec = match.group(1).strip()
        if spec and spec not in specs:
            specs.append(spec)
    return specs


def extract_python_imports(source_code: str, current_file: str) -> List[str]:
    """
    Extracts Python import module names using `ast.parse` (with regex fallback if syntax is incomplete).
    Converts relative imports (e.g. `from .utils import helper`) into relative path specifiers.
    """
    specs: List[str] = []
    cur_dir = pathlib.PurePosixPath(_normalize_rel_path(current_file)).parent

    try:
        tree = ast.parse(source_code)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name not in specs:
                        specs.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                module_name = node.module or ""
                if node.level > 0:
                    # Relative import: level=1 is '.', level=2 is '..'
                    prefix = "./" if node.level == 1 else "../" * (node.level - 1)
                    rel_target = prefix + module_name.replace(".", "/")
                    if rel_target not in specs:
                        specs.append(rel_target)
                    # Also check if imported symbol itself is a submodule file
                    for alias in node.names:
                        sub_candidate = f"{rel_target.rstrip('/')}/{alias.name}"
                        if sub_candidate not in specs:
                            specs.append(sub_candidate)
                else:
                    if module_name and module_name not in specs:
                        specs.append(module_name)
                    for alias in node.names:
                        sub_candidate = f"{module_name}.{alias.name}" if module_name else alias.name
                        if sub_candidate not in specs:
                            specs.append(sub_candidate)
    except SyntaxError:
        # Fallback regex for partial/diff Python files
        for m in re.finditer(r"^\s*(?:from\s+([\w\.]+)\s+import|import\s+([\w\.]+))", source_code, re.MULTILINE):
            mod = m.group(1) or m.group(2)
            if mod and mod not in specs:
                specs.append(mod)

    return specs


def _is_local_js_specifier(spec: str) -> bool:
    """Returns True if a JS/TS specifier refers to a local workspace file rather than node_modules."""
    return (
        spec.startswith("./")
        or spec.startswith("../")
        or spec.startswith("@/")
        or spec.startswith("~/")
        or spec.startswith("src/")
        or spec.startswith("app/")
    )


def resolve_import_to_workspace_file(
    current_file: str,
    import_spec: str,
    available_files: Set[str],
    is_python: bool = False,
) -> Tuple[Optional[str], bool]:
    """
    Attempts to resolve `import_spec` imported from `current_file` against `available_files`.
    Returns `(resolved_file_path, is_external_package)`.
    """
    cur_posix = pathlib.PurePosixPath(_normalize_rel_path(current_file))
    cur_dir = cur_posix.parent

    if not is_python:
        if not _is_local_js_specifier(import_spec):
            # External npm package (e.g. 'react', 'axios', 'zod')
            pkg_name = import_spec
            if not import_spec.startswith("@") and "/" in import_spec:
                pkg_name = import_spec.split("/")[0]
            elif import_spec.startswith("@") and import_spec.count("/") >= 2:
                parts = import_spec.split("/")
                pkg_name = f"{parts[0]}/{parts[1]}"
            return pkg_name, True

        # Convert alias or relative specifier to candidate base path
        if import_spec.startswith("@/") or import_spec.startswith("~/"):
            stripped = import_spec[2:]
            candidate_bases = [
                _normalize_rel_path(f"src/{stripped}"),
                _normalize_rel_path(stripped),
            ]
        elif import_spec.startswith("./") or import_spec.startswith("../"):
            joined = _normalize_rel_path(str(cur_dir.joinpath(import_spec)))
            # Resolve '..' segments cleanly
            norm_parts: List[str] = []
            for part in joined.split("/"):
                if part in ("", "."):
                    continue
                if part == "..":
                    if norm_parts:
                        norm_parts.pop()
                else:
                    norm_parts.append(part)
            candidate_bases = ["/".join(norm_parts)]
        else:
            candidate_bases = [_normalize_rel_path(import_spec)]

        for base in candidate_bases:
            for ext in _RESOLVABLE_EXTENSIONS:
                cand = f"{base}{ext}"
                if cand in available_files:
                    return cand, False
        return None, False

    # Python resolution
    if import_spec.startswith("./") or import_spec.startswith("../"):
        joined = _normalize_rel_path(str(cur_dir.joinpath(import_spec)))
        norm_parts = []
        for part in joined.split("/"):
            if part in ("", "."):
                continue
            if part == "..":
                if norm_parts:
                    norm_parts.pop()
            else:
                norm_parts.append(part)
        base_candidate = "/".join(norm_parts)
        for ext in (".py", "/__init__.py", ""):
            cand = f"{base_candidate}{ext}"
            if cand in available_files:
                return cand, False
        return None, False

    # Absolute Python import (could be local module like `acme_pay.ledger_core` or stdlib/PyPI)
    slash_path = import_spec.replace(".", "/")
    candidate_bases = [
        slash_path,
        f"src/{slash_path}",
        f"backend/{slash_path}",
        f"app/{slash_path}",
    ]
    if str(cur_dir) != ".":
        candidate_bases.insert(0, f"{cur_dir}/{slash_path}")

    for base in candidate_bases:
        norm_base = _normalize_rel_path(base)
        for ext in (".py", "/__init__.py"):
            cand = f"{norm_base}{ext}"
            if cand in available_files:
                return cand, False

    top_pkg = import_spec.split(".")[0]
    return top_pkg, True


# ==============================================================================
# CORE GRAPH SLICER ENGINE
# ==============================================================================

def slice_workspace_by_imports(
    workspace_files: Dict[str, str],
    entry_file: str,
    max_depth: int = 3,
    repo_name: str = "workspace/fullstack-app",
) -> WorkspaceSliceResult:
    """
    Given a virtual workspace (`{relative_path: file_content}`) and an `entry_file`,
    performs a Breadth-First Search (BFS) over static/dynamic imports up to `max_depth`.

    For Frontend pages (`.tsx`, `.jsx`, `.ts`, `.js`), this slices ONLY the entry page
    and its transitively imported components, hooks, API client wrappers, and validators—
    allowing full security & invariant verification without starting a frontend server.
    """
    normalized_map: Dict[str, str] = {}
    skipped_heavy: List[str] = []

    for raw_path, content in workspace_files.items():
        norm = _normalize_rel_path(raw_path)
        fname = pathlib.PurePosixPath(norm).name
        if any(norm.startswith(p) for p in _HEAVY_IGNORE_PREFIXES) or fname in _HEAVY_IGNORE_FILENAMES:
            skipped_heavy.append(norm)
            continue
        normalized_map[norm] = content

    norm_entry = _normalize_rel_path(entry_file)
    if norm_entry not in normalized_map:
        # Fuzzy match by suffix if exact relative path differs
        matches = [k for k in normalized_map if k.endswith(norm_entry)]
        if matches:
            norm_entry = matches[0]
        else:
            raise ValueError(f"Entry file '{entry_file}' not found in workspace ({len(normalized_map)} files available).")

    available_set = set(normalized_map.keys())
    visited_order: List[str] = [norm_entry]
    visited_set: Set[str] = {norm_entry}
    edges: List[ImportDependencyEdge] = []
    external_pkgs: Set[str] = set()
    unresolved: Set[str] = set()

    # BFS queue: (file_path, current_depth)
    queue: List[Tuple[str, int]] = [(norm_entry, 0)]

    while queue:
        current_path, depth = queue.pop(0)
        if depth >= max_depth:
            continue

        code = normalized_map.get(current_path, "")
        is_py = current_path.endswith(".py")
        raw_specs = extract_python_imports(code, current_path) if is_py else extract_js_ts_imports(code)

        for spec in raw_specs:
            resolved_path, is_external = resolve_import_to_workspace_file(
                current_file=current_path,
                import_spec=spec,
                available_files=available_set,
                is_python=is_py,
            )
            if is_external and resolved_path:
                external_pkgs.add(resolved_path)
            elif resolved_path:
                edges.append(
                    ImportDependencyEdge(
                        source_file=current_path,
                        target_file=resolved_path,
                        raw_import_spec=spec,
                        depth=depth + 1,
                    )
                )
                if resolved_path not in visited_set:
                    visited_set.add(resolved_path)
                    visited_order.append(resolved_path)
                    queue.append((resolved_path, depth + 1))
            else:
                if not is_py:
                    unresolved.add(spec)

    # Unvisited workspace files are also skipped from the sandbox mount
    unvisited_files = sorted(f for f in available_set if f not in visited_set)
    all_skipped = sorted(set(skipped_heavy + unvisited_files))

    # Determine ecosystem & whether live server DAST is needed
    has_ts_js = any(f.endswith((".ts", ".tsx", ".js", ".jsx")) for f in visited_order)
    has_py = any(f.endswith(".py") for f in visited_order)
    if has_ts_js and has_py:
        ecosystem: Literal["typescript_react", "python", "mixed"] = "mixed"
    elif has_ts_js:
        ecosystem = "typescript_react"
    else:
        ecosystem = "python"

    # Build combined code context for LLM + Sandbox verification
    bundled_chunks: List[str] = []
    total_bytes = 0
    for fpath in visited_order:
        fcontent = normalized_map[fpath]
        total_bytes += len(fcontent.encode("utf-8"))
        comment_prefix = "#" if fpath.endswith(".py") else "//"
        bundled_chunks.append(
            f"{comment_prefix} ======================================================================\n"
            f"{comment_prefix} SLICE FILE: {fpath}\n"
            f"{comment_prefix} ======================================================================\n"
            f"{fcontent.strip()}\n"
        )
    bundled_code = "\n\n".join(bundled_chunks)

    # Check if backend server daemon markers exist in the slice
    combined_lower = bundled_code.lower()
    server_markers = ("fastapi(", "flask(", "app.get(", "app.post(", "router.post(", "uvicorn", "listen(")
    requires_live_dast = has_py and any(m in combined_lower for m in server_markers)

    total_ws_count = len(workspace_files)
    sliced_count = len(visited_order)
    reduction_pct = round(
        ((total_ws_count - sliced_count) / max(1, total_ws_count)) * 100.0,
        1,
    )
    mount_kb = round(max(1.2, total_bytes / 1024.0), 2)

    scope_mode: Literal["SINGLE_FILE_UNIT", "SPARSE_PACKAGE_TREE", "LIVE_SERVER_DAEMON"] = (
        "LIVE_SERVER_DAEMON"
        if requires_live_dast
        else ("SPARSE_PACKAGE_TREE" if sliced_count > 1 else "SINGLE_FILE_UNIT")
    )

    rationale = (
        f"Static Import Graph Slicer traced {sliced_count} reachable files from entry '{norm_entry}' "
        f"(depth <= {max_depth}), pruning {len(all_skipped)} unrelated workspace files ({reduction_pct}% reduction). "
        + (
            "Frontend/UI slice verified via static AST + invariant unit harness without booting a heavy dev server."
            if not requires_live_dast
            else "Backend HTTP route handlers detected in slice; eligible for Live Server DAST (`LIVE_SERVER_DAEMON`)."
        )
    )

    scope_triage = ScopeTriageResult(
        scope_mode=scope_mode,
        selection_source="agent_auto",
        primary_target_file=norm_entry,
        mounted_files=visited_order,
        skipped_heavy_paths=all_skipped[:12],
        estimated_mount_size_kb=mount_kb,
        rationale=rationale,
    )

    return WorkspaceSliceResult(
        entry_file=norm_entry,
        language_ecosystem=ecosystem,
        requires_live_server_dast=requires_live_dast,
        max_depth=max_depth,
        mounted_files=visited_order,
        dependency_edges=edges,
        external_packages=sorted(external_pkgs),
        unresolved_imports=sorted(unresolved),
        skipped_heavy_paths=all_skipped,
        total_workspace_files=total_ws_count,
        sliced_file_count=sliced_count,
        context_reduction_pct=reduction_pct,
        estimated_mount_size_kb=mount_kb,
        bundled_code_context=bundled_code,
        scope_triage=scope_triage,
    )


# ==============================================================================
# BUILT-IN SAMPLE FULL-STACK IDE WORKSPACE (FOR OUT-OF-THE-BOX DEMO & TESTING)
# ==============================================================================

SAMPLE_IDE_WORKSPACE_FILES: Dict[str, str] = {
    # --- Entry Frontend Page (Target of Page-Level Slicing without Frontend Server) ---
    "src/pages/RefundCheckoutPage.tsx": """\
import React, { useState } from 'react';
import { RefundAmountInput } from '../components/RefundAmountInput';
import { postInstantRefund, buildRefundPreviewHtml } from '@/api/refundClient';
import { validateRefundInput } from '../utils/currencyValidator';

export function RefundCheckoutPage({ chargeId, maxRefundable, userNote }: {
  chargeId: string;
  maxRefundable: number;
  userNote: string;
}) {
  const [amount, setAmount] = useState<number>(0);

  async function handleRefundSubmit() {
    // Subtle Bug 1: validateRefundInput allows negative numbers when bypassBounds=true
    if (!validateRefundInput(amount, maxRefundable)) {
      throw new Error('Invalid refund amount');
    }
    return await postInstantRefund(chargeId, amount);
  }

  // Subtle Bug 2: DOM XSS sink via unsanitized buildRefundPreviewHtml(userNote)
  const previewMarkup = buildRefundPreviewHtml(userNote);

  return (
    <div className="refund-page">
      <RefundAmountInput value={amount} onChange={setAmount} />
      <div dangerouslySetInnerHTML={{ __html: previewMarkup }} />
      <button onClick={handleRefundSubmit}>Issue Instant Refund</button>
    </div>
  );
}
""",
    # --- Imported Child Component (Hop 1) ---
    "src/components/RefundAmountInput.tsx": """\
import React from 'react';
import { formatIsoCurrency } from '../utils/currencyValidator';

export function RefundAmountInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label>
      Refund Amount ({formatIsoCurrency(value, 'USD')}):
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}
""",
    # --- Imported API Client (Hop 1 via @/ alias) ---
    "src/api/refundClient.ts": """\
import axios from 'axios';
import { signClientRequest } from '../utils/cryptoSigner';

export async function postInstantRefund(chargeId: string, refundAmount: number) {
  const payload = { charge_id: chargeId, refund_amount: refundAmount };
  const signature = signClientRequest(JSON.stringify(payload));
  // Subtle Bug 3: Client-side HMAC secret exposed in browser bundle via cryptoSigner
  return axios.post('/api/v1/refunds/instant', payload, {
    headers: { 'X-Client-Signature': signature },
  });
}

export function buildRefundPreviewHtml(rawCustomerNote: string): string {
  // Subtle Bug 2 (Origin): Unescaped HTML interpolation enabling stored/reflected DOM XSS
  return `<div class="note-preview">Customer Reason: ${rawCustomerNote}</div>`;
}
""",
    # --- Imported Validator Utility (Hop 1 & Hop 2) ---
    "src/utils/currencyValidator.ts": """\
export function validateRefundInput(amount: number, maxRefundable: number): boolean {
  // BUG: Missing `amount <= 0` guard! Negative refund amounts pass client validation.
  if (Number.isNaN(amount)) {
    return false;
  }
  return amount <= maxRefundable;
}

export function formatIsoCurrency(amount: number, currency: string = 'USD'): string {
  return `${currency} ${amount.toFixed(2)}`;
}
""",
    # --- Imported Crypto Utility (Hop 2 from refundClient.ts) ---
    "src/utils/cryptoSigner.ts": """\
// BUG: Hardcoded signing key bundled into client-side TypeScript import tree
const NEXT_PUBLIC_FALLBACK_HMAC_KEY = "sk_live_frontend_leaked_key_9912";

export function signClientRequest(body: string): string {
  return `hmac_sha256:${NEXT_PUBLIC_FALLBACK_HMAC_KEY.slice(0, 10)}:${body.length}`;
}
""",
    # --- Unrelated Frontend Pages (Should be PRUNED by Import Graph Slicer!) ---
    "src/pages/AdminAnalyticsDashboard.tsx": """\
import React from 'react';
import { ChartWidget } from '../components/ChartWidget';
export function AdminAnalyticsDashboard() { return <ChartWidget />; }
""",
    "src/components/ChartWidget.tsx": """\
import React from 'react';
export function ChartWidget() { return <div>Heavy D3 Analytics Chart</div>; }
""",
    "src/pages/MarketingLandingPage.tsx": """\
import React from 'react';
export function MarketingLandingPage() { return <section>Welcome to ACME Pay</section>; }
""",
    "src/pages/UserSettingsProfile.tsx": """\
import React from 'react';
export function UserSettingsProfile() { return <div>Profile Settings</div>; }
""",
    # --- Backend Live Server Files (Separate Backend Entry Point) ---
    "backend_app/server.py": """\
from fastapi import FastAPI, HTTPException, Header
from backend_app.ledger_service import execute_refund_transaction, query_receipt_by_sql

app = FastAPI(title="ACME Pay Refund Microservice")

@app.get("/health")
def health():
    return {"status": "ok", "service": "acme-pay-refund-daemon"}

@app.post("/api/v1/refunds/instant")
def create_instant_refund(payload: dict, x_tenant_id: str = Header(default="tenant_default")):
    return execute_refund_transaction(
        charge_id=payload.get("charge_id", "ch_100"),
        refund_amount=float(payload.get("refund_amount", 0.0)),
        idempotency_key=payload.get("idempotency_key", "idem_1"),
        tenant_id=x_tenant_id,
    )

@app.get("/api/v1/refunds/search")
def search_refunds(q: str = ""):
    return query_receipt_by_sql(q)
""",
    "backend_app/ledger_service.py": """\
import sqlite3

def execute_refund_transaction(charge_id: str, refund_amount: float, idempotency_key: str, tenant_id: str) -> dict:
    # BUG 1 (INV-1): Negative refund_amount inflates wallet balance
    # BUG 2 (INV-2): Missing tenant_id ownership check (Cross-Tenant IDOR)
    if refund_amount > 500.0:
        raise ValueError("Exceeds max refundable 500.0")
    return {
        "charge_id": charge_id,
        "refund_amount": refund_amount,
        "new_wallet_delta": +refund_amount,
        "tenant_id": tenant_id,
        "status": "SETTLED",
    }

def query_receipt_by_sql(raw_query: str) -> dict:
    # BUG 3 (INV-3): Raw string interpolation in SQL query (SQL Injection)
    sql = f"SELECT * FROM refund_receipts WHERE charge_id = '{raw_query}'"
    return {"executed_sql": sql}
""",
    # --- Heavy Lockfiles & Artifacts (Should be automatically ignored) ---
    "package-lock.json": '{"name": "acme-pay-web", "lockfileVersion": 3, "packages": {}}',
    "node_modules/react/index.js": "module.exports = {};",
    "dist/bundle.min.js": "// compiled bundle",
}
