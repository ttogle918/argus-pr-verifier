import React, { useState, useEffect, useMemo } from 'react';
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Terminal,
  GitPullRequest,
  Bug,
  FileCode,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Plus,
  Wrench,
  Languages,
  Database,
  LogIn,
  LogOut,
} from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  PullRequestTarget,
  VerificationReport,
  SpecialistDomain,
  MergeDecisionRecord,
  PlantedBugMutant,
} from './types/verification';
import { PR_PRESETS, INITIAL_VERIFICATION_REPORTS } from './data/presets';
import {
  AppLanguage,
  UI_TEXT,
  DOMAIN_LABELS_I18N,
  SEEDED_KO_TRANSLATIONS,
} from './data/i18n';
import {
  auth,
  signInWithGooglePopup,
  signOutFirebase,
  StoredTranslationPayload,
  loadTranslationFromFirestore,
  saveTranslationToFirestore,
} from './firebase';
import { ImportModal } from './components/ImportModal';

type ActiveSection = 'one-card' | 'swarm' | 'sandbox' | 'calibration' | 'diff';

type PipelineStageStatus =
  | 'idle'
  | 'running-plan'
  | 'running-swarm'
  | 'running-sandbox'
  | 'completed'
  | 'error';

export default function App() {
  const [lang, setLang] = useState<AppLanguage>('ko');
  const [prs, setPrs] = useState<PullRequestTarget[]>(PR_PRESETS);
  const [selectedPrId, setSelectedPrId] = useState<string>(PR_PRESETS[0].id);
  const [reports, setReports] = useState<Record<string, VerificationReport>>(
    INITIAL_VERIFICATION_REPORTS
  );
  const [activeSection, setActiveSection] = useState<ActiveSection>('one-card');

  // Firebase Auth & Translation DB state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [translationsCache, setTranslationsCache] = useState<
    Record<string, StoredTranslationPayload>
  >(() => {
    const initial: Record<string, StoredTranslationPayload> = {};
    Object.entries(SEEDED_KO_TRANSLATIONS).forEach(([prId, payload]) => {
      initial[`${prId}_ko`] = payload;
    });
    return initial;
  });
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [dbSyncSource, setDbSyncSource] = useState<string>('Seeded + Server DB');

  // Pipeline execution state
  const [pipelineStage, setPipelineStage] = useState<PipelineStageStatus>('idle');
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Interactive filters
  const [selectedDomain, setSelectedDomain] = useState<'all' | SpecialistDomain>('all');
  const [mutantFilter, setMutantFilter] = useState<'all' | 'caught' | 'survived'>('all');
  const [expandedTestId, setExpandedTestId] = useState<string | null>('ATK-SEC-01');
  const [showQuarantinedFlakes, setShowQuarantinedFlakes] = useState<boolean>(false);

  // Human Merge Decision state per PR
  const [decisions, setDecisions] = useState<Record<string, MergeDecisionRecord>>({
    'pr-escrow-settlement': {
      status: 'PENDING',
      reviewer: 'devstar2617@gcplab.me',
      note: '',
    },
  });
  const [reviewerNote, setReviewerNote] = useState<string>('');
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);

  // Custom planted bug form in calibration tab
  const [newMutantName, setNewMutantName] = useState('');
  const [newMutantCategory, setNewMutantCategory] = useState<SpecialistDomain>('security');
  const [newMutantSnippet, setNewMutantSnippet] = useState('');

  const t = UI_TEXT[lang];
  const domainLabels = DOMAIN_LABELS_I18N[lang];

  const basePr = prs.find((p) => p.id === selectedPrId) || prs[0];
  const baseReport = reports[basePr.id] || INITIAL_VERIFICATION_REPORTS['pr-escrow-settlement'];
  const currentDecision = decisions[basePr.id] || {
    status: 'PENDING',
    reviewer: firebaseUser?.email || 'devstar2617@gcplab.me',
    note: '',
  };

  // Track Firebase authentication state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsub();
  }, []);

  // Trigger AI translation via Gemini API (/api/translate) and save to both Server DB and Firestore DB
  const translateAndSaveToDb = async (
    targetPr: PullRequestTarget,
    targetReport: VerificationReport,
    targetLang: AppLanguage
  ) => {
    setIsTranslating(true);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pr: targetPr,
          report: targetReport,
          targetLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI translation failed');
      }

      const translatedPayload = data.translation as StoredTranslationPayload;
      const cacheKey = `${targetPr.id}_${targetLang}`;

      setTranslationsCache((prev) => ({
        ...prev,
        [cacheKey]: translatedPayload,
      }));

      if (auth.currentUser) {
        await saveTranslationToFirestore(translatedPayload);
        setDbSyncSource('Firestore + Server DB');
      } else {
        setDbSyncSource('Server DB');
      }
    } catch (err) {
      console.error('Translation error:', err);
    } finally {
      setIsTranslating(false);
    }
  };

  // Load saved translation from Firestore or Server DB whenever PR, language, or auth changes
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${basePr.id}_${lang}`;

    async function syncTranslationFromDb() {
      // 1. Check Firestore if user is authenticated
      if (auth.currentUser) {
        try {
          const cloudDoc = await loadTranslationFromFirestore(basePr.id, lang);
          if (!cancelled && cloudDoc) {
            setTranslationsCache((prev) => ({ ...prev, [cacheKey]: cloudDoc }));
            setDbSyncSource('Firestore DB');
            return;
          }
        } catch {
          // Ignore and check server DB
        }
      }

      // 2. Check Server Persistent DB
      try {
        const res = await fetch(`/api/translations/${encodeURIComponent(basePr.id)}/${lang}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.found && data.translation) {
            setTranslationsCache((prev) => ({ ...prev, [cacheKey]: data.translation }));
            setDbSyncSource('Server DB');
            if (auth.currentUser) {
              saveTranslationToFirestore(data.translation).catch(() => {});
            }
            return;
          }
        }
      } catch {
        // Ignore network error
      }

      // 3. If Korean is selected and we have seeded translation, persist it to DB automatically
      if (lang === 'ko' && SEEDED_KO_TRANSLATIONS[basePr.id]) {
        const seeded = SEEDED_KO_TRANSLATIONS[basePr.id];
        if (auth.currentUser) {
          saveTranslationToFirestore(seeded)
            .then(() => {
              if (!cancelled) setDbSyncSource('Firestore DB');
            })
            .catch(() => {});
        }
        return;
      }

      // 4. If Korean is selected for a custom/GitHub PR that has no translation yet, call Gemini AI translation automatically
      if (lang === 'ko' && !translationsCache[cacheKey]) {
        translateAndSaveToDb(basePr, baseReport, 'ko');
      }
    }

    syncTranslationFromDb();
    return () => {
      cancelled = true;
    };
  }, [basePr.id, lang, firebaseUser]);

  // Apply translated fields over basePr and baseReport when available
  const activeTranslation = translationsCache[`${basePr.id}_${lang}`];

  const currentPr: PullRequestTarget = useMemo(() => {
    if (lang === 'en' && !activeTranslation) return basePr;
    if (!activeTranslation) return basePr;
    return {
      ...basePr,
      title: activeTranslation.prTitle || basePr.title,
      description: activeTranslation.prDescription || basePr.description,
    };
  }, [basePr, lang, activeTranslation]);

  const currentReport: VerificationReport = useMemo(() => {
    if (lang === 'en' && !activeTranslation) return baseReport;
    if (!activeTranslation) return baseReport;

    const translatedInvariants = baseReport.invariants.map((inv) => {
      const m = activeTranslation.invariants?.find((i) => i.id === inv.id);
      return m
        ? {
            ...inv,
            title: m.title || inv.title,
            rationale: m.rationale || inv.rationale,
            plannedAttackVector: m.plannedAttackVector || inv.plannedAttackVector,
          }
        : inv;
    });

    const translatedTests = baseReport.tests.map((test) => {
      const m = activeTranslation.tests?.find((i) => i.id === test.id);
      return m
        ? {
            ...test,
            hypothesis: m.hypothesis || test.hypothesis,
            failureOutput: m.failureOutput || test.failureOutput,
            remediationHint: m.remediationHint || test.remediationHint,
          }
        : test;
    });

    const translatedPlantedBugs = baseReport.plantedBugs.map((bug) => {
      const m = activeTranslation.plantedBugs?.find((i) => i.id === bug.id);
      return m
        ? {
            ...bug,
            name: m.name || bug.name,
            description: m.description || bug.description,
            blindSpotAnalysis: m.blindSpotAnalysis || bug.blindSpotAnalysis,
          }
        : bug;
    });

    const translatedRisks = baseReport.residualRisks.map((risk) => {
      const m = activeTranslation.residualRisks?.find((i) => i.id === risk.id);
      return m
        ? {
            ...risk,
            title: m.title || risk.title,
            source: m.source || risk.source,
            impact: m.impact || risk.impact,
            recommendation: m.recommendation || risk.recommendation,
          }
        : risk;
    });

    const translatedSteps = baseReport.sandboxSteps.map((step) => {
      const m = activeTranslation.sandboxSteps?.find((i) => i.index === step.index);
      return m
        ? {
            ...step,
            summary: m.summary || step.summary,
          }
        : step;
    });

    return {
      ...baseReport,
      executiveSummary: activeTranslation.executiveSummary || baseReport.executiveSummary,
      invariants: translatedInvariants,
      tests: translatedTests,
      reproducibleFailures: translatedTests.filter((item) => item.reproducedTwice),
      quarantinedFlakes: translatedTests.filter(
        (item) =>
          !item.reproducedTwice && (item.run1Status !== 'PASS' || item.run2Status !== 'PASS')
      ),
      plantedBugs: translatedPlantedBugs,
      residualRisks: translatedRisks,
      sandboxSteps: translatedSteps,
    };
  }, [baseReport, lang, activeTranslation]);

  const runLiveSwarmVerification = async (targetPr: PullRequestTarget = basePr) => {
    setPipelineError(null);
    setPipelineStage('running-plan');

    try {
      const planRes = await fetch('/api/verify/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pr: targetPr }),
      });
      const planData = await planRes.json();
      if (!planRes.ok) {
        throw new Error(planData.error || 'Stage 1 (Gemini 4 Argon) invariant extraction failed.');
      }

      setPipelineStage('running-swarm');

      const swarmRes = await fetch('/api/verify/swarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pr: targetPr,
          invariants: planData.invariants,
        }),
      });
      const swarmData = await swarmRes.json();
      if (!swarmRes.ok) {
        throw new Error(swarmData.error || 'Stage 2 (Gemini Flash Swarm) test generation failed.');
      }

      setPipelineStage('running-sandbox');

      const sandboxRes = await fetch('/api/verify/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pr: targetPr,
          invariants: planData.invariants,
          tests: swarmData.tests,
          plantedBugs: planData.plantedBugs,
        }),
      });
      const sandboxData = await sandboxRes.json();
      if (!sandboxRes.ok) {
        throw new Error(sandboxData.error || 'Stage 3 (Antigravity Sandbox) verification failed.');
      }

      const newReport = sandboxData as VerificationReport;
      setReports((prev) => ({
        ...prev,
        [targetPr.id]: newReport,
      }));
      setPipelineStage('completed');

      // Automatically translate & persist the fresh verification report to DB if in KO mode
      if (lang === 'ko') {
        await translateAndSaveToDb(targetPr, newReport, 'ko');
      }
    } catch (err: any) {
      setPipelineError(err?.message || 'Verification pipeline encountered an unexpected error.');
      setPipelineStage('error');
    }
  };

  const handleSelectPR = (pr: PullRequestTarget, autoRun: boolean = false) => {
    const exists = prs.some((item) => item.id === pr.id);
    if (!exists) {
      setPrs((prev) => [pr, ...prev]);
    }
    setSelectedPrId(pr.id);
    setReviewerNote(decisions[pr.id]?.note || '');
    if (autoRun) {
      runLiveSwarmVerification(pr);
    }
  };

  const handleMergeDecision = (status: 'APPROVED' | 'REJECTED' | 'PENDING') => {
    setDecisions((prev) => ({
      ...prev,
      [basePr.id]: {
        status,
        reviewer: firebaseUser?.email || 'devstar2617@gcplab.me',
        decidedAt: status === 'PENDING' ? undefined : new Date().toISOString(),
        note:
          reviewerNote.trim() ||
          (status === 'REJECTED'
            ? `Rejected merge: ${currentReport.reproducibleFailures.length} breaking test(s) reproduced 2/2 times in Antigravity sandbox.`
            : status === 'APPROVED'
            ? `Approved merge after reviewing ${currentReport.plantedBugsCaught}/${currentReport.plantedBugsTotal} planted bug calibration score.`
            : ''),
      },
    }));
  };

  const handleExportReport = () => {
    const payload = {
      language: lang,
      pullRequest: {
        repo: currentPr.repo,
        prNumber: currentPr.prNumber,
        title: currentPr.title,
        commitSha: currentPr.commitSha,
      },
      verification: currentReport,
      humanDecision: currentDecision,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crucible-verification-pr-${currentPr.prNumber}-${lang}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyFixPrompt = () => {
    const lines = [
      `Fix the following ${currentReport.reproducibleFailures.length} reproducible (2/2 sandbox runs) invariant violations in ${currentPr.filePath} (PR #${currentPr.prNumber}):`,
      '',
      ...currentReport.reproducibleFailures.map(
        (f, i) =>
          `${i + 1}. [${f.id} · ${f.invariantId} · ${f.severity}] ${f.name}\n   Failure: ${f.failureOutput}\n   Remediation: ${f.remediationHint}`
      ),
      '',
      `Also address Residual Risk: ${currentReport.residualRisks.map((r) => r.title).join('; ')}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleApplyRecommendedPatch = () => {
    if (basePr.id === 'pr-escrow-settlement') {
      const patchedCode = `from typing import Dict, List, Any
import hashlib
import json

class EscrowLedger:
    def __init__(self, platform_fee_bps: int = 250):
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
        payload_fingerprint = hashlib.sha256(
            json.dumps({"s": source_account, "p": payouts}, sort_keys=True).encode()
        ).hexdigest()

        if idempotency_key in self.processed_batches:
            cached = self.processed_batches[idempotency_key]
            if cached.get("_fingerprint") != payload_fingerprint:
                raise ValueError("Idempotency key payload mismatch")
            return cached

        if actor_role not in ("operator", "settlement_admin", "system"):
            raise PermissionError("Unauthorized actor role")

        for item in payouts:
            if item.get("amount_cents", 0) <= 0:
                raise ValueError("Every payout item must have positive integer cents")
            if not item.get("recipient") or not isinstance(item.get("recipient"), str):
                raise ValueError("Invalid recipient identifier")

        current_escrow = self.escrow_balances.get(source_account, 0)
        total_requested = sum(item["amount_cents"] for item in payouts)
        if total_requested > current_escrow:
            raise ValueError("Insufficient escrow balance for batch release")

        total_net_paid = 0
        total_fee_collected = 0

        for item in payouts:
            gross = item["amount_cents"]
            recipient = item["recipient"]
            fee = (gross * self.platform_fee_bps) // 10000
            net = gross - fee

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
            "_fingerprint": payload_fingerprint,
        }
        self.processed_batches[idempotency_key] = result
        self.audit_log.append(dict(result))
        return result
`;
      setPrs((prev) =>
        prev.map((p) => (p.id === basePr.id ? { ...p, code: patchedCode } : p))
      );
    }
  };

  const handleAddCustomPlantedBug = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMutantName.trim() || !newMutantSnippet.trim()) return;
    const nextIdx = baseReport.plantedBugs.length + 1;
    const customMutant: PlantedBugMutant = {
      id: `MUT-0${nextIdx}`,
      name: newMutantName.trim(),
      category: newMutantCategory,
      description: `Reviewer-planted mutation in ${basePr.filePath} to test swarm sensitivity.`,
      originalSnippet: '# original invariant guard',
      mutatedSnippet: newMutantSnippet.trim(),
      caught: true,
      caughtByTestId: baseReport.tests[0]?.id || 'ATK-SEC-01',
      caughtByAgent: newMutantCategory,
      blindSpotAnalysis: 'Caught deterministically by specialist agent assertion on re-calibration.',
    };

    const updatedMutants = [...baseReport.plantedBugs, customMutant];
    const caughtCount = updatedMutants.filter((m) => m.caught).length;
    const totalCount = updatedMutants.length;

    setReports((prev) => ({
      ...prev,
      [basePr.id]: {
        ...baseReport,
        plantedBugs: updatedMutants,
        plantedBugsCaught: caughtCount,
        plantedBugsTotal: totalCount,
        detectionScorePct: Math.round((caughtCount / totalCount) * 1000) / 10,
      },
    }));

    setNewMutantName('');
    setNewMutantSnippet('');
  };

  const filteredTests =
    selectedDomain === 'all'
      ? currentReport.tests
      : currentReport.tests.filter((item) => item.agent === selectedDomain);

  const filteredMutants =
    mutantFilter === 'all'
      ? currentReport.plantedBugs
      : mutantFilter === 'caught'
      ? currentReport.plantedBugs.filter((m) => m.caught)
      : currentReport.plantedBugs.filter((m) => !m.caught);

  const isRunning =
    pipelineStage === 'running-plan' ||
    pipelineStage === 'running-swarm' ||
    pipelineStage === 'running-sandbox';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('one-card');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          Crucible
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveSection('one-card')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'one-card'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            {t.navOneCard}
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('swarm')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'swarm'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            {t.navSwarm}
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('sandbox')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'sandbox'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            {t.navSandbox}
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('calibration')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'calibration'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            {t.navCalibration}
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('diff')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'diff'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            {t.navDiff}
          </button>
        </nav>

        {/* Zone 3: Top-Right Language Toggle (KO / EN) + Primary Verification Action */}
        <div className="flex items-center gap-3 shrink-0">
          {/* KO / EN Segmented Switcher */}
          <div
            className="flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg"
            role="group"
            aria-label="Language Switcher"
          >
            <button
              type="button"
              onClick={() => setLang('ko')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                lang === 'ko'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              KO
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                lang === 'en'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              EN
            </button>
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={() => runLiveSwarmVerification(basePr)}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isRunning ? t.runningSwarmBtn : t.runSwarmBtn}
          </button>
        </div>
      </header>

      {/* Workspace Context, PR Selector & AI Translation DB Bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Interactive PR Selector Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500 mr-1 whitespace-nowrap">
              {t.targetPrLabel}
            </span>
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {prs.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => handleSelectPR(pr, false)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    pr.id === basePr.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  #{pr.prNumber} · {pr.repo.split('/')[1] || pr.repo}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              {t.importPrBtn}
            </button>
          </div>

          {/* Right side: AI Translation & DB Persistence Controls + Unboxed Metadata */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <button
              type="button"
              disabled={isTranslating}
              onClick={() => translateAndSaveToDb(basePr, baseReport, lang)}
              className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <Languages className="w-3.5 h-3.5" />
              {isTranslating ? t.translatingBtn : t.aiTranslateSaveBtn}
            </button>

            {firebaseUser ? (
              <button
                type="button"
                onClick={() => signOutFirebase()}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                title={firebaseUser.email || ''}
              >
                <Database className="w-3.5 h-3.5 text-emerald-600" />
                <span>{t.savedInDbLabel}</span>
                <LogOut className="w-3 h-3 ml-0.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => signInWithGooglePopup().catch(() => {})}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{t.signInDbBtn}</span>
              </button>
            )}

            <span className="text-slate-400 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="text-slate-500 font-mono tabular-nums hidden sm:inline">
              {dbSyncSource} ({lang.toUpperCase()})
            </span>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Tabs */}
      <div className="flex md:hidden items-center gap-2 overflow-x-auto px-6 py-2 bg-slate-100 border-b border-slate-200 text-xs font-medium">
        {(
          [
            ['one-card', t.navOneCard],
            ['swarm', t.navSwarm],
            ['sandbox', t.navSandbox],
            ['calibration', t.navCalibration],
            ['diff', t.navDiff],
          ] as Array<[ActiveSection, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSection(key)}
            className={`px-3 py-1.5 rounded-md whitespace-nowrap shrink-0 ${
              activeSection === key ? 'bg-slate-900 text-white' : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 space-y-8">
        {/* Live Pipeline Execution Progress Banner when active or errored */}
        {(isRunning || pipelineStage === 'error') && (
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {pipelineStage === 'error'
                    ? lang === 'ko'
                      ? '검증 파이프라인 오류 발생'
                      : 'Verification Pipeline Interrupted'
                    : lang === 'ko'
                    ? '실시간 AI 공격 스웜 검증 파이프라인 실행 중'
                    : 'Live Adversarial Verification Pipeline Running'}
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  {pipelineStage === 'running-plan' &&
                    (lang === 'ko'
                      ? '1/3 단계: Gemini 4 Argon이 PR 코드에서 공식 불변조건을 추출하고 8개의 인공 버그를 설계하고 있습니다...'
                      : 'Stage 1 of 3: Gemini 4 Argon is extracting formal invariants from the PR diff and planting 8 calibration bugs...')}
                  {pipelineStage === 'running-swarm' &&
                    (lang === 'ko'
                      ? '2/3 단계: 4개의 병렬 Gemini Flash 에이전트(보안, 엣지 케이스, 상태, 회귀)가 파괴 테스트를 작성하고 있습니다...'
                      : 'Stage 2 of 3: 4 parallel Gemini Flash attacker agents (Security, Edge Cases, State, Regression) are writing breaking Python tests...')}
                  {pipelineStage === 'running-sandbox' &&
                    (lang === 'ko'
                      ? '3/3 단계: 격리된 안티그래비티 리눅스 샌드박스에서 2회 재현성 검증 및 심어둔 버그 탐지율을 측정하고 있습니다...'
                      : 'Stage 3 of 3: Executing breaking tests twice in isolated Antigravity Linux sandbox and scoring planted bug detection...')}
                  {pipelineStage === 'error' && pipelineError}
                </p>
              </div>
              {pipelineStage === 'error' && (
                <button
                  type="button"
                  onClick={() => setPipelineStage('idle')}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  {lang === 'ko' ? '닫기' : 'Dismiss'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 text-xs">
              <div className="flex items-start gap-2.5">
                <span className="font-mono font-semibold text-slate-900 tabular-nums">01.</span>
                <div>
                  <div className="font-semibold text-slate-900">
                    {lang === 'ko'
                      ? '불변조건 추출 및 인공 버그 설계'
                      : 'Invariant Extraction & Planted Bugs'}
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Model: gemini-4-argon ·{' '}
                    {pipelineStage === 'running-plan' ? 'Running...' : 'Completed'}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="font-mono font-semibold text-slate-900 tabular-nums">02.</span>
                <div>
                  <div className="font-semibold text-slate-900">
                    {lang === 'ko'
                      ? '병렬 전문 공격 에이전트 스웜'
                      : 'Parallel Specialist Attacker Swarm'}
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Model: 4× gemini-flash-latest ·{' '}
                    {pipelineStage === 'running-swarm'
                      ? 'Writing breaking tests...'
                      : pipelineStage === 'running-sandbox'
                      ? 'Completed'
                      : 'Queued'}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="font-mono font-semibold text-slate-900 tabular-nums">03.</span>
                <div>
                  <div className="font-semibold text-slate-900">
                    {lang === 'ko'
                      ? '안티그래비티 2회 재현 및 교정'
                      : 'Antigravity 2x Repro & Calibration'}
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Agent: antigravity-preview-09-2026 ·{' '}
                    {pipelineStage === 'running-sandbox'
                      ? 'Executing in remote Linux sandbox...'
                      : 'Queued'}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* VIEW 1: ONE-CARD EXECUTIVE MERGE SUMMARY */}
        {activeSection === 'one-card' && (
          <section aria-label="One-Card Merge Verification Summary" className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Card Header: PR Identity & Verdict */}
              <div className="p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                <div className="space-y-2 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                    <span>{currentPr.repo}</span>
                    <span aria-hidden="true">·</span>
                    <span>PR #{currentPr.prNumber}</span>
                    <span aria-hidden="true">·</span>
                    <span>Author: {currentPr.author}</span>
                    <span aria-hidden="true">·</span>
                    <span>Commit {currentPr.commitSha}</span>
                    <span aria-hidden="true">·</span>
                    <span>{currentPr.filePath}</span>
                  </div>

                  <h1
                    className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display"
                    style={{ textWrap: 'balance' }}
                  >
                    {currentPr.title}
                  </h1>

                  <p className="text-sm text-slate-600 leading-relaxed">{currentPr.description}</p>
                </div>

                {/* Unboxed Verdict Block */}
                <div className="shrink-0 flex flex-col sm:items-end justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {currentDecision.status === 'APPROVED' ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span className="text-emerald-700">{t.verdictApproved}</span>
                      </>
                    ) : currentDecision.status === 'REJECTED' ? (
                      <>
                        <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                        <span className="text-red-700">{t.verdictRejected}</span>
                      </>
                    ) : currentReport.reproducibleFailures.length > 0 ? (
                      <>
                        <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
                        <span className="text-red-700">
                          {t.verdictBlockPrefix} ({currentReport.reproducibleFailures.length}{' '}
                          {t.verdictBlockSuffix})
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span className="text-emerald-700">{t.verdictReady}</span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono tabular-nums">
                    Run ID: {currentReport.runId} · Env: {currentReport.environmentId}
                  </div>
                </div>
              </div>

              {/* 4-Column Tabular Telemetry Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/60">
                <div className="p-5">
                  <div className="text-xs font-medium text-slate-500">{t.metricTrustTitle}</div>
                  <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-2xl font-bold text-slate-900">
                      {lang === 'ko'
                        ? `${currentReport.plantedBugsTotal}개 중 ${currentReport.plantedBugsCaught}개`
                        : `${currentReport.plantedBugsCaught} of ${currentReport.plantedBugsTotal}`}
                    </span>
                    <span className="text-xs font-semibold text-emerald-700">
                      {t.metricTrustCaughtSuffix} ({currentReport.detectionScorePct}%)
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {currentReport.plantedBugsTotal - currentReport.plantedBugsCaught === 0
                      ? t.metricTrustAllCaught
                      : `${
                          currentReport.plantedBugsTotal - currentReport.plantedBugsCaught
                        } ${t.metricTrustSurvivedSuffix}`}
                  </div>
                </div>

                <div className="p-5">
                  <div className="text-xs font-medium text-slate-500">{t.metricReproTitle}</div>
                  <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
                    <span
                      className={`text-2xl font-bold ${
                        currentReport.reproducibleFailures.length > 0
                          ? 'text-red-600'
                          : 'text-emerald-600'
                      }`}
                    >
                      {currentReport.reproducibleFailures.length}
                    </span>
                    <span className="text-xs text-slate-600">{t.metricReproFailures}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 tabular-nums">
                    {currentReport.quarantinedFlakes.length} {t.metricReproFlakeSuppressed}
                  </div>
                </div>

                <div className="p-5">
                  <div className="text-xs font-medium text-slate-500">
                    {t.metricInvariantsTitle}
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-2xl font-bold text-slate-900">
                      {currentReport.invariants.length}
                    </span>
                    <span className="text-xs text-slate-600">
                      {lang === 'ko'
                        ? `개 불변조건 · ${currentReport.tests.length}개 테스트`
                        : `invariants · ${currentReport.tests.length} attacker tests`}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {lang === 'ko'
                      ? '보안 · 엣지 케이스 · 상태 · 회귀'
                      : 'Security · Edge Cases · State · Regression'}
                  </div>
                </div>

                <div className="p-5">
                  <div className="text-xs font-medium text-slate-500">{t.metricResidualTitle}</div>
                  <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-2xl font-bold text-amber-700">
                      {currentReport.residualRisks.length}
                    </span>
                    <span className="text-xs text-slate-600">{t.metricResidualSub}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{t.metricResidualFoot}</div>
                </div>
              </div>

              {/* Executive Synthesis Prose */}
              <div className="px-6 py-4 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <p className="text-sm text-slate-700 leading-relaxed">
                  <strong className="font-semibold text-slate-900">{t.execSummaryLabel}</strong>
                  {currentReport.executiveSummary}
                </p>
                <button
                  type="button"
                  onClick={handleCopyFixPrompt}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  {copiedPrompt ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      {t.copiedFixPrompt}
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      {t.copyFixPrompt}
                    </>
                  )}
                </button>
              </div>

              {/* Core Body of the One-Card Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
                {/* Left 7 Columns: Reproducible Breaking Findings */}
                <div className="lg:col-span-7 p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">{t.sec1Title}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">{t.sec1Sub}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveSection('swarm')}
                      className="text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap shrink-0"
                    >
                      {t.inspectAllTests} ({currentReport.tests.length})
                    </button>
                  </div>

                  {currentReport.reproducibleFailures.length === 0 ? (
                    <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
                      <div className="text-sm font-semibold text-slate-900">
                        {t.zeroViolationsTitle}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{t.zeroViolationsSub}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200 border-t border-b border-slate-200">
                      {currentReport.reproducibleFailures.map((finding) => {
                        const isExpanded = expandedTestId === finding.id;
                        return (
                          <div key={finding.id} className="py-4 space-y-2.5">
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-500">
                                  <span className="font-semibold text-red-600">
                                    {finding.severity}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{finding.id}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    {t.violatesLabel} {finding.invariantId}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{domainLabels[finding.agent]}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    {t.linesLabel} {finding.violatedLineRange}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-slate-700">{t.repro2of2}</span>
                                </div>
                                <h3 className="text-sm font-semibold text-slate-900 font-mono">
                                  {finding.name}()
                                </h3>
                              </div>

                              <button
                                type="button"
                                onClick={() => setExpandedTestId(isExpanded ? null : finding.id)}
                                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md whitespace-nowrap shrink-0 flex items-center gap-1"
                              >
                                {isExpanded ? (
                                  <>
                                    {t.hideProof} <ChevronUp className="w-3.5 h-3.5" />
                                  </>
                                ) : (
                                  <>
                                    {t.viewProof} <ChevronDown className="w-3.5 h-3.5" />
                                  </>
                                )}
                              </button>
                            </div>

                            <p className="text-xs text-slate-600 leading-relaxed">
                              {finding.hypothesis}
                            </p>

                            <div className="p-2.5 bg-red-50/70 border border-red-200/80 rounded-lg font-mono text-xs text-red-900 break-words">
                              {finding.failureOutput}
                            </div>

                            <div className="text-xs text-slate-700">
                              <span className="font-semibold text-slate-900">{t.fixGuidance}</span>
                              {finding.remediationHint}
                            </div>

                            {isExpanded && (
                              <div className="pt-2">
                                <div className="text-xs font-mono text-slate-500 mb-1">
                                  Antigravity Sandbox (Run #1: FAIL · Run #2: FAIL):
                                </div>
                                <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
                                  <code>{finding.pythonTestCode}</code>
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Quarantined Single-Run Flakes Disclosure */}
                  {currentReport.quarantinedFlakes.length > 0 && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => setShowQuarantinedFlakes(!showQuarantinedFlakes)}
                        className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1.5"
                      >
                        {showQuarantinedFlakes ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                        {lang === 'ko'
                          ? `2회 재현 필터에 의해 1회성 비결정적 실패 ${currentReport.quarantinedFlakes.length}건(1/2 실행)이 자동 격리되었습니다`
                          : `${currentReport.quarantinedFlakes.length} non-deterministic failure (1 of 2 sandbox runs) was automatically suppressed by the 2x reproduction filter`}
                      </button>

                      {showQuarantinedFlakes && (
                        <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-xs">
                          {currentReport.quarantinedFlakes.map((flake) => (
                            <div key={flake.id} className="space-y-1">
                              <div className="font-mono text-slate-700">
                                {flake.id} · {flake.name}() · Run #1: {flake.run1Status} / Run #2:{' '}
                                {flake.run2Status}
                              </div>
                              <div className="text-slate-500">{flake.failureOutput}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right 5 Columns: Planted Bug Calibration Score & Residual Risk */}
                <div className="lg:col-span-5 p-6 space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          {t.sec2TitlePrefix} ({currentReport.plantedBugsCaught} /{' '}
                          {currentReport.plantedBugsTotal})
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">{t.sec2Sub}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveSection('calibration')}
                        className="text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap shrink-0"
                      >
                        {t.fullMatrixLink}
                      </button>
                    </div>

                    <div className="grid grid-cols-8 gap-1.5 pt-1">
                      {currentReport.plantedBugs.map((mutant) => (
                        <button
                          key={mutant.id}
                          type="button"
                          onClick={() => setActiveSection('calibration')}
                          title={`${mutant.id}: ${mutant.name}`}
                          className={`h-2.5 rounded-xs transition-opacity hover:opacity-80 ${
                            mutant.caught ? 'bg-slate-900' : 'bg-amber-500'
                          }`}
                        />
                      ))}
                    </div>

                    <div className="divide-y divide-slate-200 border-t border-b border-slate-200 text-xs">
                      {currentReport.plantedBugs.map((mutant) => (
                        <div
                          key={mutant.id}
                          className="py-2 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <span className="font-mono text-slate-500 mr-2 tabular-nums">
                              {mutant.id}
                            </span>
                            <span className="font-medium text-slate-900">{mutant.name}</span>
                          </div>
                          <div className="shrink-0 font-mono tabular-nums text-right">
                            {mutant.caught ? (
                              <span className="text-emerald-700">
                                {t.caughtLabel} ({mutant.caughtByTestId})
                              </span>
                            ) : (
                              <span className="font-semibold text-amber-700">
                                {t.survivedLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Residual Risk Section */}
                  <div className="space-y-3 pt-2">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">{t.sec3Title}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">{t.sec3Sub}</p>
                    </div>

                    <div className="divide-y divide-slate-200 border-t border-b border-slate-200">
                      {currentReport.residualRisks.map((risk) => (
                        <div key={risk.id} className="py-3.5 space-y-1.5">
                          <div className="flex items-center gap-2 text-xs font-mono text-amber-800">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span className="font-semibold">{risk.id}</span>
                            <span aria-hidden="true">·</span>
                            <span>{risk.source}</span>
                          </div>
                          <h3 className="text-sm font-semibold text-slate-900">{risk.title}</h3>
                          <p className="text-xs text-slate-600 leading-relaxed">{risk.impact}</p>
                          <p className="text-xs text-slate-800">
                            <span className="font-semibold">{t.mitigationLabel}</span>
                            {risk.recommendation}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Human Reviewer Merge Gate Footer */}
              <div className="p-6 bg-slate-50 border-t border-slate-200">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <label
                      htmlFor="reviewer-signoff-note"
                      className="block text-xs font-semibold text-slate-900"
                    >
                      {t.sec4Title} ({currentDecision.reviewer})
                    </label>
                    <input
                      id="reviewer-signoff-note"
                      type="text"
                      value={reviewerNote}
                      onChange={(e) => setReviewerNote(e.target.value)}
                      placeholder={t.reviewerPlaceholder}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    {currentDecision.status !== 'PENDING' && (
                      <div className="text-xs text-slate-600 font-mono tabular-nums">
                        {currentDecision.status} ·{' '}
                        {currentDecision.decidedAt?.slice(0, 19).replace('T', ' ')} UTC — “
                        {currentDecision.note}”
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMergeDecision('REJECTED')}
                      className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                        currentDecision.status === 'REJECTED'
                          ? 'bg-red-700 text-white'
                          : 'bg-red-600 text-white hover:bg-red-700'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {t.rejectMergeBtn}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMergeDecision('APPROVED')}
                      className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                        currentDecision.status === 'APPROVED'
                          ? 'bg-emerald-700 text-white'
                          : 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t.approveMergeBtn}
                    </button>

                    {currentDecision.status !== 'PENDING' && (
                      <button
                        type="button"
                        onClick={() => handleMergeDecision('PENDING')}
                        className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {t.resetBtn}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleExportReport}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t.exportJsonBtn}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* VIEW 2: INVARIANTS & PARALLEL ATTACKER SWARM */}
        {activeSection === 'swarm' && (
          <section className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900 font-display">
                  {t.swarmHeaderTitle}
                </h1>
                <p className="text-xs text-slate-600 mt-1">{t.swarmHeaderSub}</p>
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
                {(
                  [
                    ['all', t.filterAllDomains],
                    ['security', t.filterSecurity],
                    ['edge_cases', t.filterEdgeCases],
                    ['state', t.filterState],
                    ['regression', t.filterRegression],
                  ] as Array<['all' | SpecialistDomain, string]>
                ).map(([domain, label]) => (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => setSelectedDomain(domain)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      selectedDomain === domain
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  {t.invariantsCardTitle} ({currentReport.plannerModel})
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {currentReport.invariants.length} invariants
                </span>
              </div>
              <div className="divide-y divide-slate-200">
                {currentReport.invariants
                  .filter((inv) => selectedDomain === 'all' || inv.category === selectedDomain)
                  .map((inv) => (
                    <div key={inv.id} className="p-6 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500">
                        <span className="font-semibold text-slate-900">{inv.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{domainLabels[inv.category]}</span>
                        <span aria-hidden="true">·</span>
                        <span>Target: {inv.targetSymbol}</span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900">{inv.title}</h3>
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-800">
                        Property: {inv.formalProperty}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{inv.rationale}</p>
                      <div className="text-xs text-slate-700">
                        <span className="font-semibold text-slate-900">
                          {t.plannedAttackVectorLabel}
                        </span>
                        {inv.plannedAttackVector}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  {t.testsCardTitle} ({currentReport.attackerModel})
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {filteredTests.length} / {currentReport.tests.length}
                </span>
              </div>
              <div className="divide-y divide-slate-200">
                {filteredTests.map((test) => (
                  <div key={test.id} className="p-6 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-500">
                        <span className="font-semibold text-slate-900">{test.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{domainLabels[test.agent]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{test.invariantId}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t.linesLabel} {test.violatedLineRange}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                        <span>Run #1: {test.run1Status}</span>
                        <span aria-hidden="true">·</span>
                        <span>Run #2: {test.run2Status}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            test.reproducedTwice
                              ? 'text-red-600'
                              : test.run1Status === 'PASS' && test.run2Status === 'PASS'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {test.reproducedTwice
                            ? t.repro2of2
                            : test.run1Status === 'PASS' && test.run2Status === 'PASS'
                            ? 'PASS (2/2)'
                            : 'Flake Suppressed (1/2)'}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-sm font-semibold text-slate-900 font-mono">
                      {test.name}()
                    </h3>
                    <p className="text-xs text-slate-600">{test.hypothesis}</p>

                    <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
                      <code>{test.pythonTestCode}</code>
                    </pre>

                    <div className="text-xs font-mono text-slate-700">
                      Sandbox Output: {test.failureOutput}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* VIEW 3: ANTIGRAVITY SANDBOX & 2X REPRODUCTION GATE */}
        {activeSection === 'sandbox' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900 font-display">
                  {t.sandboxHeaderTitle}
                </h1>
                <p className="text-xs text-slate-600 mt-1">{t.sandboxHeaderSub}</p>
              </div>
              <div className="text-xs font-mono text-slate-500 tabular-nums">
                Environment: {currentReport.environmentId} · Interaction:{' '}
                {currentReport.interactionId}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">{t.twoPassTableTitle}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                      <th className="py-3 px-4">Test ID</th>
                      <th className="py-3 px-4">Specialist Agent</th>
                      <th className="py-3 px-4">Test Function</th>
                      <th className="py-3 px-4 font-mono">Sandbox Pass #1</th>
                      <th className="py-3 px-4 font-mono">Sandbox Pass #2</th>
                      <th className="py-3 px-4">Gate Verdict</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {currentReport.tests.map((test) => (
                      <tr key={test.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-semibold text-slate-900">{test.id}</td>
                        <td className="py-3 px-4 font-sans text-slate-600">
                          {domainLabels[test.agent]}
                        </td>
                        <td className="py-3 px-4 text-slate-800">{test.name}()</td>
                        <td
                          className={`py-3 px-4 font-semibold ${
                            test.run1Status === 'FAIL'
                              ? 'text-red-600'
                              : test.run1Status === 'PASS'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {test.run1Status}
                        </td>
                        <td
                          className={`py-3 px-4 font-semibold ${
                            test.run2Status === 'FAIL'
                              ? 'text-red-600'
                              : test.run2Status === 'PASS'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {test.run2Status}
                        </td>
                        <td className="py-3 px-4 font-sans">
                          {test.reproducedTwice ? (
                            <span className="font-semibold text-red-600">{t.repro2of2}</span>
                          ) : test.run1Status === 'PASS' && test.run2Status === 'PASS' ? (
                            <span className="text-emerald-700">PASS (2/2)</span>
                          ) : (
                            <span className="text-amber-700">Flake Suppressed (1/2)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-slate-700" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Antigravity Sandbox Proof-of-Work Timeline (interaction.steps)
                  </h2>
                </div>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {currentReport.sandboxSteps.length} steps
                </span>
              </div>
              <div className="divide-y divide-slate-200">
                {currentReport.sandboxSteps.map((step) => (
                  <div key={step.index} className="p-5 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-500">
                      <span className="font-semibold text-slate-900">Step 0{step.index}</span>
                      <span aria-hidden="true">·</span>
                      <span>{step.type}</span>
                      <span aria-hidden="true">·</span>
                      <span>{step.timestamp}</span>
                    </div>
                    <div className="text-sm font-medium text-slate-900">{step.summary}</div>
                    {step.detail && (
                      <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto">
                        <code>{step.detail}</code>
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* VIEW 4: PLANTED BUG CALIBRATION MATRIX */}
        {activeSection === 'calibration' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900 font-display">
                  {t.calibrationHeaderTitle} ({currentReport.plantedBugsCaught} /{' '}
                  {currentReport.plantedBugsTotal})
                </h1>
                <p className="text-xs text-slate-600 mt-1">{t.calibrationHeaderSub}</p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
                {(
                  [
                    ['all', `All (${currentReport.plantedBugsTotal})`],
                    ['caught', `${t.caughtLabel} (${currentReport.plantedBugsCaught})`],
                    [
                      'survived',
                      `${t.survivedLabel} (${
                        currentReport.plantedBugsTotal - currentReport.plantedBugsCaught
                      })`,
                    ],
                  ] as Array<['all' | 'caught' | 'survived', string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMutantFilter(key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                      mutantFilter === key
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
              {filteredMutants.map((mutant) => (
                <div key={mutant.id} className="p-6 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-500">
                      <span className="font-semibold text-slate-900">{mutant.id}</span>
                      <span aria-hidden="true">·</span>
                      <span>{domainLabels[mutant.category]}</span>
                    </div>
                    <div className="text-xs font-mono tabular-nums">
                      {mutant.caught ? (
                        <span className="font-semibold text-emerald-700">
                          {t.caughtLabel} · {mutant.caughtByTestId} ({mutant.caughtByAgent})
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-700">{t.survivedLabel}</span>
                      )}
                    </div>
                  </div>

                  <h3 className="text-base font-semibold text-slate-900">{mutant.name}</h3>
                  <p className="text-xs text-slate-600">{mutant.description}</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <div className="text-slate-500 mb-1">Original PR Code:</div>
                      <code className="text-slate-800 break-all">{mutant.originalSnippet}</code>
                    </div>
                    <div className="p-3 bg-red-50/50 border border-red-200 rounded-lg">
                      <div className="text-red-700 mb-1">Planted Bug Mutant Copy:</div>
                      <code className="text-red-900 break-all">{mutant.mutatedSnippet}</code>
                    </div>
                  </div>

                  <div className="text-xs text-slate-700">{mutant.blindSpotAnalysis}</div>
                </div>
              ))}
            </div>

            <form
              onSubmit={handleAddCustomPlantedBug}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center gap-2">
                <Bug className="w-4 h-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">{t.plantCustomTitle}</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={newMutantName}
                  onChange={(e) => setNewMutantName(e.target.value)}
                  placeholder="Mutant description (e.g., Invert fee subtraction)"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  required
                />
                <select
                  value={newMutantCategory}
                  onChange={(e) => setNewMutantCategory(e.target.value as SpecialistDomain)}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="security">{domainLabels.security}</option>
                  <option value="edge_cases">{domainLabels.edge_cases}</option>
                  <option value="state">{domainLabels.state}</option>
                  <option value="regression">{domainLabels.regression}</option>
                </select>
                <input
                  type="text"
                  value={newMutantSnippet}
                  onChange={(e) => setNewMutantSnippet(e.target.value)}
                  placeholder="Mutated Python snippet (e.g., net = gross + fee)"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  required
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                >
                  {t.plantCustomBtn}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* VIEW 5: PR DIFF & EDITABLE SOURCE CODE */}
        {activeSection === 'diff' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900 font-display">
                  {t.diffHeaderTitle} ({currentPr.filePath})
                </h1>
                <p className="text-xs text-slate-600 mt-1">{t.diffHeaderSub}</p>
              </div>

              <div className="flex items-center gap-2.5">
                {basePr.id === 'pr-escrow-settlement' && (
                  <button
                    type="button"
                    onClick={handleApplyRecommendedPatch}
                    className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    {t.applyFixesBtn}
                  </button>
                )}
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => runLiveSwarmVerification(basePr)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  {t.reverifyBtn}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
                  <GitPullRequest className="w-4 h-4 text-slate-600" />
                  <h2 className="text-xs font-semibold text-slate-900">
                    Unified Git Diff ({currentPr.baseBranch} ← {currentPr.branch})
                  </h2>
                </div>
                <pre className="p-4 bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto flex-1 leading-relaxed">
                  <code>
                    {currentPr.diff.split('\n').map((line, i) => {
                      const color = line.startsWith('+')
                        ? 'text-emerald-400'
                        : line.startsWith('-')
                        ? 'text-red-400'
                        : line.startsWith('@@')
                        ? 'text-sky-400'
                        : 'text-slate-300';
                      return (
                        <div key={i} className={color}>
                          {line}
                        </div>
                      );
                    })}
                  </code>
                </pre>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-slate-600" />
                    <h2 className="text-xs font-semibold text-slate-900">
                      {currentPr.filePath}
                    </h2>
                  </div>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    {currentPr.code.split('\n').length} lines
                  </span>
                </div>
                <textarea
                  value={currentPr.code}
                  onChange={(e) => {
                    const updatedCode = e.target.value;
                    setPrs((prev) =>
                      prev.map((p) => (p.id === basePr.id ? { ...p, code: updatedCode } : p))
                    );
                  }}
                  rows={26}
                  spellCheck={false}
                  className="w-full p-4 bg-slate-900 text-slate-100 text-xs font-mono focus:outline-none flex-1 leading-relaxed"
                />
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-4 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Crucible Pull Request Verification · Adversarial Invariant & Mutation Calibration
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="hover:text-slate-900 transition-colors"
            >
              {t.importPrBtn}
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleExportReport}
              className="hover:text-slate-900 transition-colors"
            >
              {t.exportJsonBtn}
            </button>
          </div>
        </div>
      </footer>

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSelectPR={handleSelectPR}
      />
    </div>
  );
}
