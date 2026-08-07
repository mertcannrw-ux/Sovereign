'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUp,
  CornerDownLeft,
  Crosshair,
  Sparkles,
  Square,
  X,
  Zap,
  Send,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@app-builder/ui/utils';

export default function PromptBarPreviewPage() {
  const [activeOption, setActiveOption] = useState<number>(1);
  const [hasTarget, setHasTarget] = useState<boolean>(true);
  const [sampleText, setSampleText] = useState<string>('Make the background dark and change button to green');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('Agents-A1');

  const selectedElement = hasTarget
    ? { tagName: 'button', selector: 'button.hero-cta' }
    : null;

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
            <h1 className="text-base font-semibold">AI Prompt Bar Redesign Concepts</h1>
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
              onClick={() => setSampleText((prev) => (prev ? '' : 'Add a modern glassmorphism navbar'))}
            >
              {sampleText ? 'Clear Text' : 'Fill Sample Text'}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Navigation Tabs */}
        <div className="mb-10 flex flex-wrap gap-2 border-b border-border pb-4">
          {[
            { id: 1, name: 'Option 1: Unified Floating Capsule', tag: 'Recommended' },
            { id: 2, name: 'Option 2: Floating Slim Bar', tag: 'Linear / Raycast' },
            { id: 3, name: 'Option 3: Structured Target Dock', tag: 'Cursor / Bolt' },
            { id: 4, name: 'Option 4: Flush Integrated Dock', tag: 'Apple Minimalist' },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setActiveOption(option.id)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-xs font-medium transition-all',
                activeOption === option.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-background-subtle text-foreground-muted hover:bg-background-muted hover:text-foreground',
              )}
            >
              <span>{option.name}</span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                  activeOption === option.id
                    ? 'bg-black/20 text-primary-foreground'
                    : 'bg-background-muted text-foreground-secondary',
                )}
              >
                {option.tag}
              </span>
            </button>
          ))}
        </div>

        {/* Display Area */}
        <div className="grid gap-12 lg:grid-cols-1">
          {/* OPTION 1 */}
          {activeOption === 1 && (
            <div className="rounded-2xl border border-border bg-[#111111] p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Option 1: Unified Floating Capsule</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    OpenAI / v0 style. All controls (model picker, prompt enhancement, send button) are contained within a sleek floating card.
                  </p>
                </div>
                <Badge variant="outline" className="border-primary/40 text-primary">
                  Recommended
                </Badge>
              </div>

              {/* Live Interactive Component */}
              <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-[#161618] p-3 shadow-2xl transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/40">
                {/* Target badge */}
                {selectedElement && (
                  <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
                    <Crosshair className="h-3.5 w-3.5 text-primary" />
                    <span className="text-foreground-secondary">
                      Editing <span className="font-mono font-medium text-foreground">{selectedElement.selector}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setHasTarget(false)}
                      className="ml-auto rounded p-0.5 text-foreground-muted hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Text input */}
                <textarea
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  placeholder={selectedElement ? `Describe change for ${selectedElement.tagName}…` : 'Describe what you want to build or change…'}
                  rows={2}
                  className="w-full resize-none bg-transparent px-2 text-sm text-white placeholder:text-foreground-muted focus:outline-none"
                />

                {/* Footer Controls Bar */}
                <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-foreground-secondary hover:bg-white/10 hover:text-white"
                    >
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      <span>{selectedModel}</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>

                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-foreground-muted hover:bg-white/5 hover:text-white"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                      <span>Enhance prompt</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsSending((prev) => !prev)}
                    disabled={!sampleText.trim() && !isSending}
                    className={cn(
                      'flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all',
                      isSending
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        : sampleText.trim()
                          ? 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90'
                          : 'bg-white/10 text-white/40 cursor-not-allowed',
                    )}
                  >
                    {isSending ? (
                      <>
                        <Square className="h-3.5 w-3.5 fill-current" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <span>Send</span>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              <p className="mt-4 text-center text-[11px] text-foreground-muted">
                Press <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">⌘ Enter</kbd> to send, <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">Shift Enter</kbd> for new line
              </p>
            </div>
          )}

          {/* OPTION 2 */}
          {activeOption === 2 && (
            <div className="rounded-2xl border border-border bg-[#111111] p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Option 2: Floating Slim Bar</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Linear & Raycast inspired. Ultra-compact, single-line focus with integrated right action pill.
                  </p>
                </div>
                <Badge variant="outline" className="border-border text-foreground-secondary">
                  Linear / Raycast
                </Badge>
              </div>

              {/* Live Interactive Component */}
              <div className="mx-auto max-w-2xl">
                {selectedElement && (
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs">
                    <Crosshair className="h-3 w-3 text-primary" />
                    <span className="text-foreground-secondary">
                      Target: <span className="font-mono text-foreground">{selectedElement.selector}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setHasTarget(false)}
                      className="ml-1 text-foreground-muted hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#141416] p-2 pl-4 shadow-xl transition-all focus-within:border-white/25">
                  <input
                    type="text"
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                    placeholder="Describe what you want to build…"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-foreground-muted focus:outline-none"
                  />

                  <div className="flex items-center gap-1 rounded-xl bg-white/[0.06] p-1">
                    <span className="px-2 text-xs font-medium text-foreground-muted">{selectedModel}</span>
                    <button
                      type="button"
                      onClick={() => setIsSending((prev) => !prev)}
                      disabled={!sampleText.trim() && !isSending}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-lg transition-all',
                        isSending
                          ? 'bg-red-500 text-white'
                          : sampleText.trim()
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-white/10 text-white/30',
                      )}
                    >
                      {isSending ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* OPTION 3 */}
          {activeOption === 3 && (
            <div className="rounded-2xl border border-border bg-[#111111] p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Option 3: Structured Target Dock</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Cursor & Bolt style. Tabbed element header with dual-bar layout for element-heavy editing.
                  </p>
                </div>
                <Badge variant="outline" className="border-border text-foreground-secondary">
                  Cursor / Bolt
                </Badge>
              </div>

              {/* Live Interactive Component */}
              <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-white/15 bg-[#141414] shadow-2xl">
                {/* Header Tab */}
                <div className="flex items-center justify-between border-b border-white/10 bg-[#1A1A1A] px-4 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Crosshair className="h-3.5 w-3.5 text-primary" />
                    <span className="font-mono text-white">
                      {selectedElement ? selectedElement.selector : 'Global Workspace'}
                    </span>
                  </div>
                  <span className="text-[10px] uppercase text-foreground-muted">Target Context</span>
                </div>

                {/* Main Textarea */}
                <div className="p-4">
                  <textarea
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                    placeholder="Describe prompt changes…"
                    rows={3}
                    className="w-full resize-none bg-transparent text-sm text-white placeholder:text-foreground-muted focus:outline-none"
                  />
                </div>

                {/* Lower Toolbar */}
                <div className="flex items-center justify-between border-t border-white/10 bg-[#181818] px-4 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-foreground-muted">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <span>{selectedModel}</span>
                  </div>

                  <Button
                    size="sm"
                    className="h-8 gap-2 text-xs"
                    onClick={() => setIsSending((prev) => !prev)}
                    disabled={!sampleText.trim() && !isSending}
                  >
                    <span>{isSending ? 'Cancel' : 'Generate'}</span>
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* OPTION 4 */}
          {activeOption === 4 && (
            <div className="rounded-2xl border border-border bg-[#111111] p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Option 4: Flush Integrated Dock</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Apple Minimalist style. Edge-to-edge flush dock with minimal icon buttons.
                  </p>
                </div>
                <Badge variant="outline" className="border-border text-foreground-secondary">
                  Apple Minimalist
                </Badge>
              </div>

              {/* Live Interactive Component */}
              <div className="mx-auto max-w-2xl border-t border-b border-white/15 bg-[#121212] p-4">
                {selectedElement && (
                  <div className="mb-2 text-xs text-primary">
                    Editing <code className="rounded bg-primary/10 px-1 py-0.5">{selectedElement.selector}</code>
                  </div>
                )}
                <div className="relative">
                  <textarea
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                    placeholder="Describe changes…"
                    rows={2}
                    className="w-full resize-none bg-transparent pr-12 text-sm text-white placeholder:text-foreground-muted focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setIsSending((prev) => !prev)}
                    disabled={!sampleText.trim() && !isSending}
                    className="absolute right-0 bottom-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <CornerDownLeft className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-foreground-muted">
                  <span>Model: {selectedModel}</span>
                  <span>Press Enter to send</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
