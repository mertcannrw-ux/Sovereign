'use client';

import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Command,
  Database,
  GitBranch,
  Globe2,
  KeyRound,
  Layers3,
  MousePointer2,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Zap,
} from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as const;

const reveal: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease } },
};

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const providers = ['OpenAI', 'Anthropic', 'Google Gemini', 'Mistral'];

const workflow = [
  {
    number: '01',
    title: 'Connect your model',
    copy: 'Use the API keys you already own. Your credentials stay encrypted and under your control.',
  },
  {
    number: '02',
    title: 'Describe the outcome',
    copy: 'Start with a sentence or a detailed brief. Sovereign plans the architecture before it writes.',
  },
  {
    number: '03',
    title: 'Shape it visually',
    copy: 'Select anything on the canvas, refine it with chat, or move directly into the generated code.',
  },
  {
    number: '04',
    title: 'Ship without lock-in',
    copy: 'Deploy in a click, sync to GitHub, or export the entire codebase whenever you want.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    line: 'For exploring your next idea.',
    features: ['3 active projects', 'Visual editor', 'Full code export', 'Community templates'],
    cta: 'Start building',
  },
  {
    name: 'Pro',
    price: '$25',
    line: 'For builders who ship.',
    features: ['Unlimited projects', 'GitHub sync', 'Custom domains', 'Functions & databases'],
    cta: 'Start free trial',
    featured: true,
  },
  {
    name: 'Business',
    price: '$50',
    line: 'For product teams moving fast.',
    features: ['10 collaborators', 'Team permissions', 'Security scanning', 'Priority support'],
    cta: 'Start free trial',
  },
];

function Logo() {
  return (
    <span className="flex items-center gap-3">
      <span className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white text-[#0a0a0a]">
        <Command className="h-[18px] w-[18px]" strokeWidth={2.4} />
      </span>
      <span className="text-sm font-semibold uppercase tracking-[0.22em] text-white">Sovereign</span>
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <motion.div
      variants={reveal}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      className="max-w-2xl"
    >
      <p className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#b8ff5a]">
        <span className="h-px w-6 bg-[#b8ff5a]" />
        {eyebrow}
      </p>
      <h2 className="text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl">
        {title}
      </h2>
      <p className="mt-6 max-w-xl text-base leading-7 text-white/55 sm:text-lg">{copy}</p>
    </motion.div>
  );
}

function WorkspacePreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 36, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 1, delay: 0.55, ease }}
      className="relative mx-auto mt-16 max-w-[1180px] px-3 sm:mt-24 sm:px-6"
    >
      <div className="absolute -inset-x-12 bottom-0 top-1/4 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(184,255,90,0.12),transparent_65%)] blur-2xl" />
      <div className="overflow-hidden rounded-[20px] border border-white/[0.12] bg-[#111] shadow-[0_50px_140px_rgba(0,0,0,.7)]">
        <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-4 sm:px-5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <span className="hidden sm:inline">canvas.sovereign.dev</span>
            <ShieldCheck className="h-3.5 w-3.5 text-[#b8ff5a]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/50 sm:block">Preview</span>
            <span className="rounded-md bg-white px-2.5 py-1 text-[10px] font-semibold text-black">Deploy</span>
          </div>
        </div>

        <div className="grid min-h-[430px] grid-cols-1 md:grid-cols-[270px_1fr] lg:grid-cols-[280px_1fr_240px]">
          <div className="hidden border-r border-white/[0.08] bg-[#0d0d0d] p-4 md:flex md:flex-col">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white/70">Build with AI</span>
              <Sparkles className="h-3.5 w-3.5 text-[#b8ff5a]" />
            </div>
            <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs leading-5 text-white/60">
              Create a refined analytics dashboard for a sustainable energy company. Use warm data
              colors and generous spacing.
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex gap-2.5">
                <span className="mt-1 h-4 w-4 shrink-0 rounded-full bg-[#b8ff5a]" />
                <div>
                  <p className="text-[11px] font-medium text-white/80">Planning interface</p>
                  <p className="mt-0.5 text-[10px] text-white/35">Layout · data · components</p>
                </div>
              </div>
              <div className="flex gap-2.5">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-[#b8ff5a]/40">
                  <Check className="h-2.5 w-2.5 text-[#b8ff5a]" />
                </span>
                <div>
                  <p className="text-[11px] font-medium text-white/80">Building dashboard</p>
                  <p className="mt-0.5 text-[10px] text-white/35">12 files generated</p>
                </div>
              </div>
            </div>
            <div className="mt-auto flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-2.5">
              <span className="flex-1 text-[10px] text-white/30">Ask for a change…</span>
              <Send className="h-3.5 w-3.5 text-[#b8ff5a]" />
            </div>
          </div>

          <div className="relative overflow-hidden bg-[#e9e7df] p-4 sm:p-7">
            <div className="mx-auto h-full max-w-2xl overflow-hidden rounded-xl bg-[#f8f7f2] shadow-[0_24px_70px_rgba(20,20,15,.18)]">
              <div className="flex items-center justify-between px-5 py-4">
                <span className="text-[11px] font-bold tracking-tight text-[#24251f]">NORTH / GRID</span>
                <div className="flex items-center gap-3 text-[8px] font-semibold uppercase tracking-wider text-[#24251f]/45">
                  <span>Overview</span><span>Assets</span><span>Reports</span>
                </div>
              </div>
              <div className="border-y border-black/[0.08] px-5 py-6 sm:px-7">
                <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-[#657044]">Live network</p>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <h3 className="max-w-xs text-2xl font-semibold leading-none tracking-[-0.04em] text-[#20211c] sm:text-4xl">
                    Clean energy, intelligently distributed.
                  </h3>
                  <div className="hidden text-right sm:block">
                    <p className="text-2xl font-semibold text-[#20211c]">84.2%</p>
                    <p className="text-[8px] uppercase tracking-wider text-[#20211c]/40">Grid efficiency</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-black/[0.08] sm:grid-cols-3">
                <div className="bg-[#f8f7f2] p-4 sm:p-5">
                  <p className="text-[8px] uppercase tracking-wider text-black/35">Generation</p>
                  <p className="mt-2 text-xl font-semibold text-[#24251f] sm:text-2xl">24.8<span className="text-xs text-black/35"> GW</span></p>
                  <p className="mt-4 text-[8px] text-[#657044]">↑ 12.4% this month</p>
                </div>
                <div className="bg-[#d7ff75] p-4 sm:p-5">
                  <p className="text-[8px] uppercase tracking-wider text-black/45">Carbon avoided</p>
                  <p className="mt-2 text-xl font-semibold text-[#24251f] sm:text-2xl">8.6<span className="text-xs text-black/45"> Mt</span></p>
                  <div className="mt-4 flex h-5 items-end gap-1">
                    {[40, 62, 48, 78, 58, 92, 74].map((height) => <span key={height} className="w-full bg-black/25" style={{ height: `${height}%` }} />)}
                  </div>
                </div>
                <div className="col-span-2 bg-[#24251f] p-4 text-white sm:col-span-1 sm:p-5">
                  <p className="text-[8px] uppercase tracking-wider text-white/35">Active sites</p>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-2xl font-semibold">142</p>
                    <Globe2 className="h-7 w-7 text-[#d7ff75]" strokeWidth={1.2} />
                  </div>
                  <p className="mt-3 text-[8px] text-white/35">Across 18 regions</p>
                </div>
              </div>
            </div>
            <div className="absolute left-[42%] top-[47%] hidden md:block">
              <MousePointer2 className="h-5 w-5 fill-black text-black" />
              <span className="ml-3 rounded bg-black px-2 py-1 text-[9px] text-white">You</span>
            </div>
          </div>

          <div className="hidden border-l border-white/[0.08] bg-[#0d0d0d] p-4 lg:block">
            <div className="flex items-center justify-between text-xs text-white/70">
              <span>Properties</span><Layers3 className="h-3.5 w-3.5" />
            </div>
            {['Layout', 'Typography', 'Fill', 'Spacing'].map((item, index) => (
              <div key={item} className="border-b border-white/[0.07] py-4">
                <div className="flex items-center justify-between text-[10px] text-white/55">
                  <span>{item}</span><ChevronRight className={`h-3 w-3 ${index === 1 ? 'rotate-90' : ''}`} />
                </div>
                {index === 1 && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <span className="rounded border border-white/10 p-2 text-[9px] text-white/40">Inter</span>
                    <span className="rounded border border-white/10 p-2 text-[9px] text-white/40">36 px</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function MarketingPage() {


  return (
    <div className="min-h-screen overflow-hidden bg-[#090909] text-white selection:bg-[#b8ff5a] selection:text-black">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.07] bg-[#090909]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="Sovereign home"><Logo /></Link>
          <nav className="hidden items-center gap-8 md:flex">
            {['Product', 'Workflow', 'Pricing'].map((item) => (
              <Link key={item} href={`#${item.toLowerCase()}`} className="text-sm text-white/55 transition-colors hover:text-white">{item}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/auth/signin" className="hidden px-3 py-2 text-sm text-white/60 transition-colors hover:text-white sm:block">Sign in</Link>
            <Link href="/auth/signin" className="group flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black transition-transform hover:scale-[1.02] sm:px-5">
              Start building <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-grid relative border-b border-white/[0.08] pb-20 pt-36 sm:pb-28 sm:pt-44">
          <div className="landing-orb absolute left-1/2 top-0 -z-0 h-[520px] w-[900px] -translate-x-1/2 opacity-50" />
          <motion.div variants={stagger} initial="hidden" animate="visible" className="relative z-10 mx-auto max-w-[1320px] px-5 text-center sm:px-8">
            <motion.h1 variants={reveal} className="mx-auto max-w-5xl text-balance text-[clamp(3.25rem,8vw,7.5rem)] font-semibold leading-[1.05] tracking-[-0.065em]">
              From first thought<br /><span className="text-white/38">to shipped product.</span>
            </motion.h1>
            <motion.p variants={reveal} className="mx-auto mt-6 max-w-2xl text-balance text-base leading-7 text-white/55 sm:mt-8 sm:text-xl sm:leading-8">
              The AI workspace for building full-stack software with your own model keys. Design, code, and deploy without credits or lock-in.
            </motion.p>
            <motion.div variants={reveal} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/auth/signin" className="group flex h-13 w-full items-center justify-center gap-2 rounded-full bg-[#b8ff5a] px-7 text-sm font-semibold text-[#10130c] transition-all hover:bg-[#c8ff83] sm:w-auto">
                Build your first app <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="#product" className="flex h-13 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-7 text-sm font-medium text-white transition-colors hover:bg-white/[0.08] sm:w-auto">
                <Play className="h-3.5 w-3.5 fill-white" /> See the workspace
              </Link>
            </motion.div>
            <motion.p variants={reveal} className="mt-5 text-xs text-white/30">Free to start · No credit card · Export anytime</motion.p>
          </motion.div>
          <WorkspacePreview />
        </section>

        <section className="border-b border-white/[0.08] py-10">
          <div className="mx-auto flex max-w-[1320px] flex-col items-center gap-7 px-5 sm:px-8 lg:flex-row lg:justify-between">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30">Use the intelligence you trust</p>
            <div className="flex flex-wrap items-center justify-center gap-x-9 gap-y-4 sm:gap-x-14">
              {providers.map((provider) => <span key={provider} className="text-sm font-medium tracking-[-0.02em] text-white/48">{provider}</span>)}
            </div>
          </div>
        </section>

        <section id="product" className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 sm:py-36">
          <SectionHeading eyebrow="One connected workspace" title="A faster path from intent to interface." copy="Sovereign keeps conversation, canvas, code, and infrastructure in one place—so you stay in the flow instead of stitching tools together." />
          <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-100px' }} className="mt-16 grid gap-5 lg:grid-cols-12">
            <motion.article variants={reveal} className="group flex min-h-[480px] flex-col overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#101010] p-7 sm:p-9 lg:col-span-7 lg:p-10">
              <div className="max-w-md">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#b8ff5a] text-black"><WandSparkles className="h-5 w-5" /></span>
                <h3 className="mt-7 text-2xl font-semibold tracking-[-0.035em] sm:text-[1.75rem]">Build beyond the prompt.</h3>
                <p className="mt-4 max-w-lg leading-7 text-white/52">Sovereign understands your files, decisions, and product context. Every request improves the real application—not a disposable mockup.</p>
              </div>
              <div className="mt-10 w-full rounded-2xl border border-white/10 bg-[#171717] p-3 shadow-2xl transition-transform duration-500 group-hover:-translate-y-1 sm:ml-auto sm:w-[78%]">
                <div className="rounded-xl border border-white/10 bg-[#0c0c0c] p-5 font-mono text-[11px] leading-7 text-white/45 sm:text-xs">
                  <p><span className="text-[#c792ea]">export function</span> <span className="text-[#b8ff5a]">Dashboard</span>() {'{'}</p>
                  <p className="pl-4"><span className="text-[#c792ea]">const</span> metrics = <span className="text-[#82aaff]">useLiveData</span>();</p>
                  <p className="pl-4"><span className="text-[#c792ea]">return</span> {'<'}<span className="text-[#f78c6c]">Grid</span> data={'{'}metrics{'}'} /{'>'};</p>
                  <p>{'}'}</p>
                </div>
              </div>
            </motion.article>

            <motion.article variants={reveal} className="flex min-h-[480px] flex-col overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#d8ff7a] p-7 text-[#11140d] sm:p-9 lg:col-span-5 lg:p-10">
              <div className="max-w-sm">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-black text-white"><KeyRound className="h-5 w-5" /></span>
                <h3 className="mt-7 text-2xl font-semibold tracking-[-0.035em] sm:text-[1.75rem]">Bring your own keys.<br />Keep the leverage.</h3>
                <p className="mt-4 leading-7 text-black/58">Pay providers directly. Switch models per task. Never buy opaque platform credits again.</p>
              </div>
              <div className="mt-10 rounded-2xl bg-[#11140d] p-4 text-white sm:mt-auto sm:p-5">
                {providers.slice(0, 3).map((provider, index) => (
                  <div key={provider} className="flex items-center gap-3 border-b border-white/10 py-3 last:border-0">
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-[9px]">{provider[0]}</span>
                    <span className="flex-1 text-xs text-white/70">{provider}</span>
                    <span className={`h-1.5 w-1.5 rounded-full ${index < 2 ? 'bg-[#b8ff5a]' : 'bg-white/20'}`} />
                  </div>
                ))}
              </div>
            </motion.article>

            {[
              { icon: MousePointer2, title: 'Edit what you see', copy: 'Select any element and change layout, type, color, or content directly on the canvas.' },
              { icon: Database, title: 'Backend included', copy: 'Add auth, data, storage, and server functions without leaving your project.' },
              { icon: GitBranch, title: 'Real code, always', copy: 'Sync a clean TypeScript codebase to GitHub or export it in full at any point.' },
            ].map((feature) => (
              <motion.article key={feature.title} variants={reveal} className="flex min-h-[250px] flex-col rounded-[24px] border border-white/[0.1] bg-[#101010] p-7 sm:p-8 lg:col-span-4 lg:p-9">
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-[#b8ff5a]/20 bg-[#b8ff5a]/[0.08]"><feature.icon className="h-5 w-5 text-[#b8ff5a]" strokeWidth={1.6} /></span>
                <div className="mt-auto pt-10">
                  <h3 className="text-xl font-semibold tracking-[-0.03em]">{feature.title}</h3>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-white/45">{feature.copy}</p>
                </div>
              </motion.article>
            ))}
          </motion.div>
        </section>

        <section id="workflow" className="border-y border-white/[0.08] bg-[#0c0c0c] py-24 sm:py-36">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
            <SectionHeading eyebrow="How it works" title="Make software like you think." copy="Begin anywhere. Move between natural language, visual editing, and code without losing context or control." />
            <div className="mt-16 border-t border-white/10">
              {workflow.map((item, index) => (
                <motion.div key={item.number} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: index * 0.05, ease }} className="group grid gap-4 border-b border-white/10 py-7 sm:grid-cols-[80px_1fr_1fr_40px] sm:items-center sm:py-9">
                  <span className="font-mono text-xs text-[#b8ff5a]">{item.number}</span>
                  <h3 className="text-xl font-medium tracking-[-0.03em] sm:text-2xl">{item.title}</h3>
                  <p className="max-w-lg text-sm leading-6 text-white/42">{item.copy}</p>
                  <ArrowRight className="hidden h-5 w-5 text-white/20 transition-all group-hover:translate-x-1 group-hover:text-[#b8ff5a] sm:block" />
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 sm:py-36">
          <div className="flex flex-col justify-between gap-10 lg:flex-row lg:items-end">
            <SectionHeading eyebrow="Clear pricing" title="Pay for the workspace. Not the tokens." copy="Every plan uses your provider keys, so your AI costs stay transparent and entirely in your control." />
            <p className="max-w-xs text-sm leading-6 text-white/35">All plans include code ownership, encrypted API keys, and the freedom to leave whenever you want.</p>
          </div>
          <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-80px' }} className="mt-14 grid gap-4 lg:grid-cols-3">
            {plans.map((plan) => (
              <motion.article key={plan.name} variants={reveal} className={`relative flex min-h-[430px] flex-col rounded-[24px] border p-7 sm:p-8 ${plan.featured ? 'border-[#b8ff5a]/50 bg-[#b8ff5a] text-[#10130c]' : 'border-white/10 bg-[#101010]'}`}>
                {plan.featured && <span className="absolute right-6 top-6 rounded-full bg-black px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white">Most popular</span>}
                <p className="text-sm font-semibold">{plan.name}</p>
                <div className="mt-8 flex items-end gap-1"><span className="text-5xl font-semibold tracking-[-0.055em]">{plan.price}</span><span className={`mb-1 text-sm ${plan.featured ? 'text-black/45' : 'text-white/35'}`}>/ month</span></div>
                <p className={`mt-3 text-sm ${plan.featured ? 'text-black/55' : 'text-white/42'}`}>{plan.line}</p>
                <ul className="mt-8 space-y-3">
                  {plan.features.map((feature) => <li key={feature} className="flex items-center gap-2.5 text-sm"><Check className="h-4 w-4" />{feature}</li>)}
                </ul>
                <Link href="/auth/signin" className={`mt-auto flex h-12 items-center justify-center rounded-full text-sm font-semibold transition-transform hover:scale-[1.01] ${plan.featured ? 'bg-black text-white' : 'bg-white text-black'}`}>{plan.cta}</Link>
              </motion.article>
            ))}
          </motion.div>
        </section>

        <section className="px-5 pb-8 sm:px-8 sm:pb-12">
          <div className="landing-cta relative mx-auto max-w-[1320px] overflow-hidden rounded-[28px] border border-white/10 px-6 py-20 text-center sm:px-12 sm:py-28">
            <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease }} className="relative z-10">
              <Zap className="mx-auto h-8 w-8 text-[#b8ff5a]" />
              <h2 className="mx-auto mt-7 max-w-3xl text-balance text-4xl font-semibold leading-[1] tracking-[-0.05em] sm:text-6xl">Your next product is closer than it looks.</h2>
              <p className="mx-auto mt-5 max-w-lg text-white/50">Start free. Connect a model when you are ready. Keep every line of code you create.</p>
              <Link href="/auth/signin" className="group mx-auto mt-9 flex h-13 w-fit items-center gap-2 rounded-full bg-[#b8ff5a] px-7 text-sm font-semibold text-black">Start building free <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></Link>
            </motion.div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.08]">
        <div className="mx-auto max-w-[1320px] px-5 py-12 sm:px-8">
          <div className="flex flex-col justify-between gap-10 sm:flex-row">
            <div><Logo /><p className="mt-4 max-w-xs text-sm leading-6 text-white/35">The independent AI workspace for designing, building, and shipping real software.</p></div>
            <div className="grid grid-cols-2 gap-x-16 gap-y-4 text-sm">
              <div className="space-y-3"><p className="text-white/30">Product</p><Link className="block text-white/65 hover:text-white" href="#product">Workspace</Link><Link className="block text-white/65 hover:text-white" href="#pricing">Pricing</Link></div>
              <div className="space-y-3"><p className="text-white/30">Access</p><Link className="block text-white/65 hover:text-white" href="/auth/signin">Sign in</Link><Link className="block text-white/65 hover:text-white" href="/auth/signin">Get started</Link></div>
            </div>
          </div>
          <div className="mt-12 flex flex-col justify-between gap-3 border-t border-white/10 pt-6 text-xs text-white/25 sm:flex-row"><p>© {new Date().getFullYear()} Sovereign</p><p>Built for independent software.</p></div>
        </div>
      </footer>
    </div>
  );
}
