'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Search,
  Sparkles,
  Square,
  SlidersHorizontal,
  X,
  Zap,
  Check,
  Plus,
  Paperclip,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@app-builder/ui/utils';

const SAMPLE_MODELS = [
  { id: 'Agents-A1', name: 'Agents-A1', provider: 'Default', isDefault: true },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gemini-1-5-pro', name: 'Gemini 1.5 Pro', provider: 'Google' },
  { id: 'llama-3-3-70b', name: 'Llama 3.3 70B', provider: 'Groq' },
];

const REASONING_LEVELS = [
  { id: 'auto', label: 'Auto', desc: 'Dynamic reasoning based on prompt complexity' },
  { id: 'off', label: 'Off', desc: 'Fastest response time' },
  { id: 'low', label: 'Low', desc: 'Light analytical thinking' },
  { id: 'medium', label: 'Medium', desc: 'Balanced reasoning & code architecture' },
  { id: 'high', label: 'Extra High', desc: 'Deep step-by-step reasoning' },
];

export default function PromptBarPreviewPage() {
  const [activeConcept, setActiveConcept] = useState<number>(4);
  const [hasTarget, setHasTarget] = useState<boolean>(true);
  const [sampleText, setSampleText] = useState<string>('Make the background dark and change button to green');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('Agents-A1');
  const [selectedReasoning, setSelectedReasoning] = useState<string>('high');

  // Popover state toggles
  const [showModelPopover, setShowModelPopover] = useState<boolean>(true);
  const [activeSubMenu, setActiveSubMenu] = useState<'root' | 'models' | 'effort'>('root');
  const [modelSearch, setModelSearch] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string }>>([
    { name: 'mockup-ui.png' },
  ]);

  const selectedElement = hasTarget
    ? { tagName: 'button', selector: 'button.hero-cta' }
    : null;

  const filteredModels = SAMPLE_MODELS.filter(
    (m) =>
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.provider.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background-subtle/50 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-xs text-foreground-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Link>
            <span className="text-border">|</span>
            <h1 className="text-base font-semibold">Prompt Bar Model Picker & Reasoning Redesigns</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setHasTarget((prev) => !prev)}
            >
              <Crosshair className="mr-1.5 h-3.5 w-3.5" />
              {hasTarget ? 'Target: On' : 'Target: Off'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowModelPopover((prev) => !prev)}
            >
              Toggle Popover ({showModelPopover ? 'Open' : 'Closed'})
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Navigation Concepts */}
        <div className="mb-10 flex flex-wrap gap-2 border-b border-border pb-4">
          {[
            { id: 4, name: 'Concept 4: Right-Aligned Minimalist', tag: 'Sol / Claude Style' },
            { id: 1, name: 'Concept 1: Unified Popover Panel', tag: 'Recommended' },
            { id: 2, name: 'Concept 2: Dual Embedded Chips', tag: 'v0 / Bolt' },
            { id: 3, name: 'Concept 3: Expandable Drawer', tag: 'Linear / Raycast' },
          ].map((concept) => (
            <button
              key={concept.id}
              type="button"
              onClick={() => {
                setActiveConcept(concept.id);
                setShowModelPopover(true);
                setActiveSubMenu('root');
              }}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-xs font-medium transition-all',
                activeConcept === concept.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-background-subtle text-foreground-muted hover:bg-background-muted hover:text-foreground',
              )}
            >
              <span>{concept.name}</span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                  activeConcept === concept.id
                    ? 'bg-black/20 text-primary-foreground'
                    : 'bg-background-muted text-foreground-secondary',
                )}
              >
                {concept.tag}
              </span>
            </button>
          ))}
        </div>

        {/* Display Area */}
        <div className="grid gap-12 lg:grid-cols-1">
          {/* CONCEPT 4: RIGHT-ALIGNED MINIMALIST (Sol / Claude Style) */}
          {activeConcept === 4 && (
            <div className="rounded-2xl border border-border bg-[#111111] p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Concept 4: Right-Aligned Minimalist (Sol / Claude Style)</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Model name & Reasoning level sit right next to the circular send button. Pressing the text trigger opens the sleek configuration menu.
                  </p>
                </div>
                <Badge variant="outline" className="border-primary/40 text-primary">
                  New (Claude / Sol)
                </Badge>
              </div>

              <div className="relative mx-auto max-w-2xl">
                {/* FLOATING MENU (OPENED ABOVE THE RIGHT TRIGGER) */}
                {showModelPopover && (
                  <div className="absolute bottom-full right-12 mb-3 z-30 w-72 overflow-hidden rounded-2xl border border-white/15 bg-[#1a1a1c] p-3 shadow-2xl backdrop-blur-xl">
                    {/* ROOT MENU (Model & Effort rows) */}
                    {activeSubMenu === 'root' && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => setActiveSubMenu('models')}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5"
                        >
                          <span className="text-foreground-secondary">Model</span>
                          <div className="flex items-center gap-1 text-white">
                            <span>{selectedModel}</span>
                            <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveSubMenu('effort')}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5"
                        >
                          <span className="text-foreground-secondary">Effort</span>
                          <div className="flex items-center gap-1 text-white">
                            <span className="capitalize">{REASONING_LEVELS.find(r => r.id === selectedReasoning)?.label}</span>
                            <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                          </div>
                        </button>

                      </div>
                    )}

                    {/* MODELS SUB-MENU */}
                    {activeSubMenu === 'models' && (
                      <div>
                        <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2 text-xs font-semibold text-white">
                          <button
                            type="button"
                            onClick={() => setActiveSubMenu('root')}
                            className="flex items-center gap-1 text-foreground-muted hover:text-white"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" /> Back
                          </button>
                          <span>Select Model</span>
                        </div>

                        {/* Model Search Input */}
                        <div className="relative mb-2.5">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
                          <input
                            type="text"
                            placeholder="Search models..."
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                            className="h-9 w-full rounded-lg border border-white/20 bg-[#121214] pl-8 pr-7 text-xs font-medium text-white placeholder:text-foreground-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                          />
                          {modelSearch && (
                            <button
                              type="button"
                              onClick={() => setModelSearch('')}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-foreground-muted hover:text-white"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="space-y-1">
                          {SAMPLE_MODELS.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                setSelectedModel(m.name);
                                setActiveSubMenu('root');
                              }}
                              className={cn(
                                'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                                selectedModel === m.name
                                  ? 'bg-primary/15 text-primary font-medium'
                                  : 'text-foreground-secondary hover:bg-white/5 hover:text-white',
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <Zap className="h-3.5 w-3.5" />
                                <span>{m.name}</span>
                              </div>
                              {selectedModel === m.name && <Check className="h-3.5 w-3.5 text-primary" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* EFFORT SUB-MENU */}
                    {activeSubMenu === 'effort' && (
                      <div>
                        <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2 text-xs font-semibold text-white">
                          <button
                            type="button"
                            onClick={() => setActiveSubMenu('root')}
                            className="flex items-center gap-1 text-foreground-muted hover:text-white"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" /> Back
                          </button>
                          <span>Reasoning Effort</span>
                        </div>
                        <div className="space-y-1">
                          {REASONING_LEVELS.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                setSelectedReasoning(r.id);
                                setActiveSubMenu('root');
                              }}
                              className={cn(
                                'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                                selectedReasoning === r.id
                                  ? 'bg-primary/15 text-primary font-medium'
                                  : 'text-foreground-secondary hover:bg-white/5 hover:text-white',
                              )}
                            >
                              <span>{r.label}</span>
                              {selectedReasoning === r.id && <Check className="h-3.5 w-3.5 text-primary" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* CAPSULE CARD WITH RIGHT-ALIGNED TRIGGER & CIRCULAR BUTTON */}
                <div className="rounded-3xl border border-white/15 bg-[#1b1b1d] p-4 shadow-2xl transition-all focus-within:border-white/30">
                  {selectedElement && (
                    <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
                      <Crosshair className="h-3.5 w-3.5 text-primary" />
                      <span className="text-foreground-secondary">
                        Editing <span className="font-mono font-medium text-foreground">{selectedElement.selector}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setHasTarget(false)}
                        className="ml-auto text-foreground-muted hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  <textarea
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                    placeholder="Describe what you want to build or change…"
                    rows={2}
                    className="w-full resize-none border-none bg-transparent px-1 text-sm text-white shadow-none placeholder:text-foreground-muted outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                  />

                  {/* FOOTER BAR: RIGHT ALIGNED CONFIG TRIGGER & CIRCULAR SEND */}
                  {/* FOOTER BAR: LEFT ATTACH PLUS & RIGHT ALIGNED CONFIG TRIGGER & CIRCULAR SEND */}
                  <div className="mt-3 flex items-center justify-between pt-2">
                    {/* Left: Plus button to append images & files */}
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          if (files.length > 0) {
                            setAttachedFiles((prev) => [
                              ...prev,
                              ...files.map((f) => ({ name: f.name })),
                            ]);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-[#A1A1A1] transition-all hover:bg-white/[0.08] hover:text-white active:scale-95"
                        title="Append images or files"
                        aria-label="Append images or files"
                      >
                        <Plus className="h-5 w-5" strokeWidth={2.2} />
                      </button>

                      {/* Attached File Preview Chips */}
                      {attachedFiles.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white"
                        >
                          <Paperclip className="h-3 w-3 text-primary" />
                          <span className="max-w-[120px] truncate">{file.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-foreground-muted hover:text-white"
                            aria-label="Remove attachment"
                          >
                            <X className="h-3 3-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowModelPopover((prev) => !prev);
                          setActiveSubMenu('root');
                        }}
                        className={cn(
                          'flex items-center rounded-full bg-transparent px-3 py-1.5 text-xs transition-all hover:bg-white/[0.08]',
                          showModelPopover && 'bg-white/[0.10] ring-1 ring-white/15',
                        )}
                      >
                        <span className="font-medium text-[#E5E5E5]">{selectedModel}</span>
                        <span className="ml-2.5 font-normal text-[#9A9A9A]">
                          {REASONING_LEVELS.find((r) => r.id === selectedReasoning)?.label}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsSending((prev) => !prev)}
                        disabled={!sampleText.trim() && !isSending}
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-full transition-all',
                          isSending
                            ? 'bg-red-500 text-white shadow-md'
                            : sampleText.trim()
                              ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20'
                              : 'bg-white/10 text-white/30 cursor-not-allowed',
                        )}
                        aria-label={isSending ? "Stop agent" : "Send message"}
                      >
                        {isSending ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CONCEPT 1 */}
          {activeConcept === 1 && (
            <div className="rounded-2xl border border-border bg-[#111111] p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Concept 1: Unified Popover Panel</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Clicking the model chip opens a unified popover containing Model Search/Selection and a Reasoning Effort Slider.
                  </p>
                </div>
                <Badge variant="outline" className="border-primary/40 text-primary">
                  Recommended
                </Badge>
              </div>

              {/* Interactive Capsule with Popover */}
              <div className="relative mx-auto max-w-2xl">
                {showModelPopover && (
                  <div className="absolute bottom-full left-0 mb-3 z-30 w-80 rounded-2xl border border-white/15 bg-[#161618] p-3 shadow-2xl backdrop-blur-xl">
                    <div className="mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
                      <span className="text-xs font-semibold text-white">Model & Reasoning Config</span>
                      <button
                        type="button"
                        onClick={() => setShowModelPopover(false)}
                        className="rounded p-1 text-foreground-muted hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="relative mb-3">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models or providers..."
                        className="w-full rounded-lg border border-white/10 bg-black/40 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-foreground-muted focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {filteredModels.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedModel(m.name)}
                          className={cn(
                            'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                            selectedModel === m.name
                              ? 'bg-primary/15 text-primary font-medium'
                              : 'text-foreground-secondary hover:bg-white/5 hover:text-white',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Zap className="h-3.5 w-3.5" />
                            <span>{m.name}</span>
                          </div>
                          {selectedModel === m.name && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 border-t border-white/10 pt-2.5">
                      <div className="mb-1.5 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-foreground-secondary">Reasoning Effort</span>
                        <span className="font-mono text-primary uppercase">{selectedReasoning}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
                        {REASONING_LEVELS.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setSelectedReasoning(r.id)}
                            className={cn(
                              'rounded py-1 text-[10px] font-semibold transition-all',
                              selectedReasoning === r.id
                                ? 'bg-primary text-primary-foreground shadow'
                                : 'text-foreground-muted hover:text-white',
                            )}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-[#161618] p-3 shadow-2xl transition-all focus-within:border-primary/50">
                  <textarea
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                    rows={2}
                    className="w-full resize-none bg-transparent px-2 text-sm text-white placeholder:text-foreground-muted focus:outline-none"
                  />

                  <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                    <button
                      type="button"
                      onClick={() => setShowModelPopover((prev) => !prev)}
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-foreground-secondary"
                    >
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      <span>{selectedModel} • {selectedReasoning} ▾</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsSending((prev) => !prev)}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
                    >
                      <span>{isSending ? 'Stop' : 'Send'}</span>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CONCEPT 2 */}
          {activeConcept === 2 && (
            <div className="rounded-2xl border border-border bg-[#111111] p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Concept 2: Dual Embedded Chips</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Dedicated side-by-side chips for Model selection and Reasoning level.
                  </p>
                </div>
              </div>

              <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-[#161618] p-3 shadow-2xl">
                <textarea
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  rows={2}
                  className="w-full resize-none bg-transparent px-2 text-sm text-white focus:outline-none"
                />

                <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-foreground-secondary"
                    >
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      <span>{selectedModel} ▾</span>
                    </button>

                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-foreground-secondary"
                    >
                      <Brain className="h-3.5 w-3.5 text-amber-400" />
                      <span>Reasoning: {selectedReasoning} ▾</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    <span>Send</span>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CONCEPT 3 */}
          {activeConcept === 3 && (
            <div className="rounded-2xl border border-border bg-[#111111] p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Concept 3: Expandable Drawer</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Expandable controls drawer directly inside the prompt bar.
                  </p>
                </div>
              </div>

              <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-[#161618] p-3 shadow-2xl">
                <textarea
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  rows={2}
                  className="w-full resize-none bg-transparent px-2 text-sm text-white focus:outline-none"
                />

                <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground-muted">Select Model:</span>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="rounded border border-white/10 bg-[#141414] px-2.5 py-1 text-xs text-white focus:outline-none"
                    >
                      {SAMPLE_MODELS.map((m) => (
                        <option key={m.id} value={m.name} className="bg-[#141414] text-white">
                          {m.name} ({m.provider})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                  <span className="text-xs text-foreground-muted">Configured: {selectedModel}</span>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    <span>Send</span>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
