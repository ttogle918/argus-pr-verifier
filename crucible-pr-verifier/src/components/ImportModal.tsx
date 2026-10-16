import React, { useState } from 'react';
import { X, GitPullRequest, FileCode, AlertCircle } from 'lucide-react';
import { PullRequestTarget } from '../types/verification';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPR: (pr: PullRequestTarget, autoRun: boolean) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onSelectPR }) => {
  const [mode, setMode] = useState<'github' | 'custom'>('github');
  const [githubUrl, setGithubUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customRepo, setCustomRepo] = useState('org/payment-router');
  const [customPrNum, setCustomPrNum] = useState('512');
  const [customTitle, setCustomTitle] = useState('feat(router): automatic retry with discount coupon deduction');
  const [customFile, setCustomFile] = useState('router/checkout.py');
  const [customCode, setCustomCode] = useState(`class CheckoutProcessor:
    def __init__(self):
        self.used_coupons = set()

    def apply_checkout(self, user_id: str, subtotal_cents: int, discount_cents: int, coupon_code: str = "") -> int:
        # AI-generated checkout calculation
        if coupon_code:
            self.used_coupons.add(coupon_code)
        total = subtotal_cents - discount_cents
        return total
`);

  if (!isOpen) return null;

  const handleFetchGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/github/pr?url=${encodeURIComponent(githubUrl.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not load GitHub Pull Request');
      }
      onSelectPR(data as PullRequestTarget, true);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch GitHub PR');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCode.trim()) {
      setError('Please provide candidate Python code to verify.');
      return;
    }
    const newPr: PullRequestTarget = {
      id: `custom-${Date.now()}`,
      repo: customRepo.trim() || 'custom/repository',
      prNumber: parseInt(customPrNum, 10) || 101,
      title: customTitle.trim() || 'Custom AI-authored Pull Request',
      author: 'ai-codegen[bot]',
      aiGenerator: 'Custom PR Submission',
      branch: 'ai/custom-candidate',
      baseBranch: 'main',
      commitSha: Math.random().toString(16).slice(2, 10),
      timestamp: new Date().toISOString(),
      description: 'Custom pull request submitted for adversarial invariant extraction and sandbox mutation testing.',
      filePath: customFile.trim() || 'module.py',
      language: 'python',
      code: customCode,
      diff: customCode
        .split('\n')
        .map((l) => `+${l}`)
        .join('\n'),
    };
    onSelectPR(newPr, true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Load Pull Request for Swarm Verification</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
          <button
            type="button"
            onClick={() => {
              setMode('github');
              setError(null);
            }}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              mode === 'github'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <GitPullRequest className="w-3.5 h-3.5" />
            Import Public GitHub PR
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('custom');
              setError(null);
            }}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              mode === 'custom'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            Paste Custom PR Code
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {mode === 'github' ? (
          <form onSubmit={handleFetchGithub} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                GitHub Pull Request URL or Shorthand
              </label>
              <input
                type="text"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/pallets/flask/pull/5402 or owner/repo#123"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
                required
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Fetches live PR metadata, changed files, and unified patch via the GitHub REST API, then dispatches Gemini 4 Argon and the Gemini Flash attacker swarm.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {loading ? 'Fetching PR from GitHub...' : 'Import & Run Swarm Verification'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreateCustom} className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Repository</label>
                <input
                  type="text"
                  value={customRepo}
                  onChange={(e) => setCustomRepo(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">PR Number</label>
                <input
                  type="number"
                  value={customPrNum}
                  onChange={(e) => setCustomPrNum(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">File Path</label>
                <input
                  type="text"
                  value={customFile}
                  onChange={(e) => setCustomFile(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Pull Request Title</label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Candidate Code (Python)
              </label>
              <textarea
                rows={8}
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                className="w-full p-3 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Load Code & Run Swarm Verification
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
