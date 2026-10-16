'use client';

import { DemoPlayer } from './demo-player';
import { buildScenes } from './build-walkthrough';
import { byokScenes, visualEditorScenes } from './closeup-videos';

/*
 * The three films, bound to their scene scripts on the client. Scenes are
 * render functions, which cannot cross the server/client boundary as props,
 * so the server-rendered sections mount these instead of DemoPlayer.
 */

export function BuildFilm() {
  return (
    <DemoPlayer
      scenes={buildScenes}
      label="Sovereign product walkthrough: a prompt becomes a running app, an element is restyled visually, the code is inspected and a version is restored."
      posterSceneId="preview"
      surfaceClassName="h-[520px] sm:h-[600px] lg:h-[640px]"
    />
  );
}

export function VisualEditorFilm() {
  return (
    <DemoPlayer
      scenes={visualEditorScenes}
      label="Close-up of the visual element editor: an element is targeted, a tool is picked, a change is typed and applied."
      posterSceneId="target"
      surfaceClassName="h-[420px] sm:h-[500px]"
    />
  );
}

export function ByokFilm() {
  return (
    <DemoPlayer
      scenes={byokScenes}
      label="Bringing your own key: the AI Providers settings tab, a key being added, and the connected state."
      posterSceneId="connected"
      surfaceClassName="h-[440px] sm:h-[520px]"
    />
  );
}
