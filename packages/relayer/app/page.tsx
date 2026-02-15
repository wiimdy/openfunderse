'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';

type Mode = 'strategy' | 'participant';

const COMMANDS: Record<Mode, { install: string; init: string }> = {
  strategy: {
    install: 'npx @wiimdy/openfunderse@latest install openfunderse-strategy --with-runtime',
    init: 'npx @wiimdy/openfunderse@latest bot-init --skill-name strategy --yes',
  },
  participant: {
    install: 'npx @wiimdy/openfunderse@latest install openfunderse-participant --with-runtime',
    init: 'npx @wiimdy/openfunderse@latest bot-init --skill-name participant --yes',
  },
};

const STEPS: Record<Mode, { label: string; href?: string }[]> = {
  strategy: [
    { label: 'Install skill pack and runtime' },
    { label: 'Initialize bot wallet with bot-init' },
    { label: 'Configure fund parameters and deploy' },
    { label: 'Register participant bots' },
  ],
  participant: [
    { label: 'Join fund via Telegram', href: 'https://t.me/openfunderse' },
    { label: 'Install skill pack and runtime' },
    { label: 'Initialize bot wallet with bot-init' },
    { label: 'Connect wallet and deposit funds' },
  ],
};

const FLOW = [
  { title: 'Claim', desc: 'Participants submit target portfolio weights' },
  { title: 'Aggregate', desc: 'Stake-weighted consensus projected into risk set' },
  { title: 'Execute', desc: 'Strategy executes toward target under constraints' },
  { title: 'Settle', desc: 'Scores settled, NAV alpha mints reward shares' },
];

export default function Page() {
  const [mode, setMode] = useState<Mode>('participant');
  const [copied, setCopied] = useState(false);

  const commands = useMemo(() => COMMANDS[mode], [mode]);
  const steps = useMemo(() => STEPS[mode], [mode]);
  const allText = `${commands.install}\n${commands.init}`;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(allText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <main className="relative min-h-screen bg-[#fbfbfd] selection:bg-gray-900 selection:text-white">
      <div className="mx-auto w-full max-w-[980px] px-6 pb-24">

        <header className="pt-10 text-center">
          <Image
            src="/logo-icon.png"
            alt="OpenFunderse"
            width={64}
            height={64}
            className="mx-auto mb-5"
            priority
          />
          <h1 className="mx-auto mt-4 max-w-2xl text-[clamp(2.4rem,5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.03em] text-gray-900">
            Agent-driven fund
            <br />
            protocol on{' '}
            <span className="bg-gradient-to-r from-violet-500 to-fuchsia-400 bg-clip-text text-transparent">
              Monad
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-gray-500">
            Claims are attested. Intents are validated.
            <br className="hidden sm:block" />
            Only approved intents execute onchain.
          </p>
        </header>

        <div className="mt-8 flex justify-center gap-3">
          <a
            href="https://t.me/openfunderse"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center rounded-full bg-gray-900 px-8 text-base font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Join Telegram
          </a>
          <a
            href="#install"
            className="inline-flex h-12 items-center rounded-full border border-gray-200 bg-white px-8 text-base font-medium text-gray-900 transition-all hover:border-gray-300 hover:shadow-sm active:scale-[0.98]"
          >
            Get Started
          </a>
        </div>

        <section id="install" className="mx-auto mt-14 max-w-2xl scroll-mt-24">
          <h2 className="text-center text-base font-semibold tracking-[0.08em] text-gray-900">
            INSTALL
          </h2>

          <div className="mx-auto mt-8 flex w-fit rounded-full border border-gray-200 bg-white p-1">
            {(['participant', 'strategy'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                  mode === m
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-700'
                }`}
              >
                {m === 'participant' ? 'Participant' : 'Strategy'}
              </button>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-gray-100 bg-[#1d1d1f]">
            <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <div className="space-y-2 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2 overflow-x-auto">
                  <p className="whitespace-nowrap font-mono text-sm leading-relaxed text-gray-300">
                    <span className="text-gray-600">1.</span> <span className="text-gray-500">$</span> {commands.install}
                  </p>
                  <p className="whitespace-nowrap font-mono text-sm leading-relaxed text-gray-300">
                    <span className="text-gray-600">2.</span> <span className="text-gray-500">$</span> {commands.init}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCopy}
                  className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-300"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          <ol className="mt-8 space-y-4">
            {steps.map((step, i) => (
              <li key={i} className="flex items-center gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-400">
                  {i + 1}
                </span>
                {step.href ? (
                  <a
                    href={step.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base text-gray-700 underline decoration-gray-200 underline-offset-4 transition-colors hover:decoration-gray-900"
                  >
                    {step.label}
                  </a>
                ) : (
                  <span className="text-base text-gray-700">{step.label}</span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-center text-base font-semibold tracking-[0.08em] text-gray-900">
            CONSENSUS FLOW
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-4">
            {FLOW.map((item, i) => (
              <div
                key={i}
                className="group rounded-2xl border border-violet-100 bg-violet-50/30 p-6 transition-shadow hover:shadow-md"
              >
                <span className="text-base font-semibold text-violet-300">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="mt-3 text-lg font-semibold text-gray-900">
                  {item.title}
                </p>
                <p className="mt-1.5 text-[15px] leading-snug text-gray-600">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="w-full border-t border-gray-100 bg-[#fbfbfd]">
        <div className="mx-auto flex max-w-[980px] items-center justify-between px-6 py-5">
          <span className="text-[12px] text-gray-300">openfunderse</span>
          <nav className="flex items-center gap-5 text-[12px] text-gray-400">
            <a
              href="https://x.com/openfunderse"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-gray-900"
            >
              X
            </a>
            <a
              href="https://t.me/openfunderse"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-gray-900"
            >
              Telegram
            </a>
            <a
              href="https://nad.fun/tokens/0x51C3c7689d65f2c7a1ac3e73195DEDdb181e7777"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-gray-900"
            >
              nad.fun
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
