'use client';

import { useMemo, useState } from 'react';

type Mode = 'strategy' | 'participant';

const COMMANDS = {
  strategy: 'npx @wiimdy/openfunderse@latest install openfunderse-strategy --with-runtime',
  participant: 'npx @wiimdy/openfunderse@latest install openfunderse-participant --with-runtime',
};

const STEPS: Record<Mode, string[]> = {
  strategy: [
    'Install strategy bot runtime',
    'Configure fund parameters and deploy',
    'Register participant bots',
  ],
  participant: [
    'Join fund via Telegram: t.me/openfunderse',
    'Install participant bot with command above',
    'Connect wallet and deposit funds',
  ],
};

export default function Page() {
  const [mode, setMode] = useState<Mode>('participant');
  const [copied, setCopied] = useState(false);

  const command = useMemo(() => COMMANDS[mode], [mode]);
  const steps = useMemo(() => STEPS[mode], [mode]);

  async function onCopyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-gray-50 p-4">
      <div className="z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-8 text-center sm:px-10">
          <p className="text-sm text-gray-500">openfunderse</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">
            Molt bot-powered fund protocol on Monad
          </h1>

          {/* Mode Toggle */}
          <div className="mt-5 flex items-center justify-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setMode('strategy')}
              className={`rounded-full border px-3 py-1 ${
                mode === 'strategy'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 text-gray-700'
              }`}
            >
              Strategy Bot
            </button>
            <button
              type="button"
              onClick={() => setMode('participant')}
              className={`rounded-full border px-3 py-1 ${
                mode === 'participant'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 text-gray-700'
              }`}
            >
              Participant Bot
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-8 sm:px-10">
          {/* Overview */}
          <div className="mb-8 text-sm text-gray-700">
            <p className="mb-3 leading-relaxed">
              Agent-driven fund protocol for Monad: claims are attested, intents are validated,
              and only approved intents execute onchain.
            </p>

            <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs">
              <p className="font-medium text-gray-900">Consensus Rebalancing Flow</p>
              <ol className="mt-2 space-y-1 pl-4 text-gray-600">
                <li>1. Participants submit target weights (portfolio allocations)</li>
                <li>2. Stake-weighted aggregate projected into feasible risk set</li>
                <li>3. Strategy executes toward target under venue constraints</li>
                <li>4. Participant scores settled; NAV alpha mints reward shares</li>
              </ol>
            </div>

            {/* Mode-specific skills */}
            {mode === 'participant' ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-blue-900">Participant Bot Skills</p>
                <ul className="mt-2 space-y-1 pl-4 text-xs text-blue-800">
                  <li>• Mine allocation claims (targetWeights) via Molt bot automation</li>
                  <li>• Validate claim structure and submit to relayer API</li>
                  <li>• Track epoch aggregation and fund performance</li>
                  <li>• Earn reward shares based on prediction accuracy</li>
                </ul>
              </div>
            ) : (
              <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-purple-900">Strategy Bot Skills*</p>
                <ul className="mt-2 space-y-1 pl-4 text-xs text-purple-800">
                  <li>• Deploy fund via ClawFundFactory (IntentBook + Core + Vault)</li>
                  <li>• Register participants and aggregate epoch claims</li>
                  <li>• Propose intents with risk projection and allowlist enforcement</li>
                  <li>• Attest intents onchain and execute approved trades</li>
                </ul>
                <p className="mt-2 border-t border-purple-200 pt-2 text-xs italic text-purple-700">
                  *Permissionless fund creation available; demo runs single fund example
                </p>
              </div>
            )}
          </div>

          <h2 className="text-lg font-medium text-gray-900">Quick Start</h2>

          {/* Install Command */}
          <div className="mt-3 flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2">
            <code className="flex-1 font-mono text-sm text-gray-100">{command}</code>
            <button
              type="button"
              onClick={onCopyCommand}
              className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-100 hover:bg-gray-800"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Steps */}
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-gray-700">
            {steps.map((step, index) => (
              <li key={index}>
                {step.includes('t.me/openfunderse') ? (
                  <>
                    Join fund via Telegram:{' '}
                    <a
                      href="https://t.me/openfunderse"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline hover:text-blue-700"
                    >
                      t.me/openfunderse
                    </a>
                  </>
                ) : (
                  step
                )}
              </li>
            ))}
          </ol>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 text-xs text-gray-500 sm:px-10">
          <div className="flex flex-wrap items-center gap-3">
            <a href="/login" className="underline hover:text-gray-900">
              Login
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
