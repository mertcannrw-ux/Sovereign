# Spec: Realms (replaces Teams)

Status: Active

Realms are shared workspaces where people and the Sovereign agent build together from the same context. This is a full replacement of Teams, not an addition.

## 0. Remove Teams (part of Milestone 1)

- Teams is removed entirely. Realms replaces it.
- Migrate existing team data into Realms: each existing team becomes a shared Realm with the same members and roles (team owner → owner, admins → admin, everyone else → member). Users without a team get only their personal Realm.
- After migration: delete Teams routes, pages, components, API endpoints, DB tables/columns and tests that only cover Teams. Remove "Team" from the sidebar rail and from Settings.
- Search the codebase for any remaining references to teams ("team", "Team", "teams") and remove or rename them. No dead code, no leftover files.
- In the final report, list everything that was removed.

## Milestone 1: Realms foundation

### Data model

- Realm: id, name, type (personal | shared), brief (text), createdAt.
- RealmMember: realmId, userId, role (owner | admin | member).
- RealmInvite: realmId, email, role, token, expiresAt, status.
- Projects and provider keys belong to a Realm.
- Every user gets a personal Realm on signup. Existing projects/keys move into their owner's personal Realm (or the migrated shared Realm if they belonged to a team).

### Permissions (enforced server-side, with tests)

- Owner: everything, incl. delete Realm, transfer ownership, billing. Exactly one owner per Realm.
- Admin: invite/remove members, change roles (not owner), manage keys, edit brief, rules and memory.
- Member: create/edit/build projects, use Realm keys, comment, read brief and memory.
- Raw API keys never reach the client for anyone. Members use keys, never see them.
- Users can only access Realms they belong to. Write tests for: member can't see raw keys; non-member can't access a Realm's projects; member can't change roles or rules.

### Realm switcher

- Top of the sidebar rail: current Realm. Menu: list of Realms, "Create Realm", "Realm settings". Switching changes projects and keys shown everywhere.

### Members (Settings > Members, shared Realms only)

- Title "Members", no eyebrow, no subtitle.
- Invite: email + role (Member/Admin) + secondary "Invite" button; "Copy invite link".
- One bordered list with dividers: avatar, name, email, role (muted text for owner, dropdown for others if permitted), "⋯" → Remove.
- Pending invites: email, role, Resend / Revoke.
- Personal Realm: one line "This is your personal Realm. Create a shared Realm to build with others." + "Create Realm".

## Milestone 2: Shared context

### Realm brief

- One editable page per Realm: brand, colors, tone, conventions, things to avoid.
- Automatically included as context in every build in that Realm.
- Owner/Admin edit, members read.
- Empty state: mascot + "Tell me how this Realm builds. I'll follow it in every project."

### Readable memory

- Everything the agent learns at Realm level is stored as plain, visible entries (text + source + date), e.g. "Buttons use the lime accent only for primary actions (from Mike's comment on Landing Page)."
- Memory page in Realm settings: everyone can read; Owner/Admin can edit or delete single entries; "Clear all" with confirm.
- The agent only adds memory entries when something is clearly a lasting preference or rule; each new entry shows up in the activity feed so people can see it was added.
- Memory is included as context in builds, after the brief.
- Personal chats/prompts are never copied into Realm memory automatically.

## Milestone 3: The agent as a teammate

### Project comments

- Each project has a comments panel (tab next to the chat). Members can comment and reply.
- Mentioning @Sovereign in a comment turns it into a build request on that project, using the Realm's keys, brief and memory.
- The agent replies in the thread: what it changed in plain language + link to the new version. Mascot shows working/done/error in the thread, following the motion spec.
- Only one agent build runs per project at a time; extra requests queue and show "Queued".

### Activity feed

- Per project and per Realm: chronological entries — who requested, what the agent did, resulting version, memory entries added, deploys, approvals.
- Each version entry has "Preview" and "Restore this version" (restore creates a new version, never deletes history).

## Milestone 4: Rules & approvals

- Realm rules page (Owner/Admin): each action has allowed / needs approval / never.
  - Build and edit projects: allowed (default)
  - Deploy to production: needs Owner/Admin approval (default)
  - Delete a project: needs approval (default)
  - Keys, billing, members, rules: never for the agent; always human (not configurable).
- Approval requests go to one "Needs your OK" list (badge in the sidebar rail for Owner/Admin). Each request shows what will happen and the diff/preview; Approve or Decline with optional note.
- No popups for approvals; a single calm list avoids approval fatigue.
- Personal Realms: rules apply to the user themselves only where it makes sense (no approvals needed).

## Out of scope (do not build)

Real-time co-editing, always-on background agents, Slack/Teams integration, third-party connectors, per-page permissions, SSO, audit export.
