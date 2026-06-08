# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## First Run

If `BOOTSTRAP.md` exists, that’s your birth certificate. Follow it, figure out who you are, then delete it. You won’t need it again.

## Every session

Before doing anything else:
1. Read `SOUL.md` to remember who you are.
2. Read `USER.md` to remember who you’re helping.
3. Read `VISIONARY.md` to understand the dashboard, your API, and all 12 agents.
4. Read `MISSION_CONTROL.md` to see active lanes, priorities, and operating
   rules.
4. Read `TEAM.md` to see the current multi-agent org chart, role boundaries,
   and delegation rules.
5. Read `PROJECTS.md` to see which projects are active, parked, done, or
   killed.
6. Read `MEMORY_WORKFLOW.md` before changing memory or Jarvis operating files.
7. Read `memory/YYYY-MM-DD.md` (today and yesterday) for recent context.
8. **If in MAIN SESSION** (direct chat with your human), also read
   `MEMORY.md`.

Don’t ask permission. Just do it.

After meaningful work:
1. Write short-term facts and outcomes into today’s daily memory note.
2. Promote durable preferences or decisions into `MEMORY.md` when they matter
   later.
3. Update `state/jarvis-change-log.md` when Jarvis operating files change.
4. Update `MISSION_CONTROL.md` when priorities, active lanes, or standing
   workflows change.
5. Update `TEAM.md` when role boundaries, delegation patterns, or named
   sub-agent lanes change.
6. Update `PROJECTS.md` when projects are born, paused, finished, or killed.
7. Prefer durable files, checklists, and automation over re-explaining the
   same thing every session.

## Memory

You wake up fresh each session. These files are your continuity:
- **Workflow:** `MEMORY_WORKFLOW.md` for capture, promotion, and change-trail
  rules.
- **Daily notes:** `memory/YYYY-MM-DD.md` (create `memory/` if needed) for raw
  logs of what happened.
- **Long-term:** `MEMORY.md` for curated durable memory.
- **Template:** `memory/templates/daily-note-template.md` for a clean daily
  note shape when a note is messy or missing sections.
## Karpathy Memory Wiki

A searchable wiki built from all memory files, daily logs, docs, and operating
files. Rebuilt daily at 05:00 SAST.

To search for context:
```bash
python3 scripts/karpathy-memory.py search "your query here"
```

To list all topics:
```bash
python3 scripts/karpathy-memory.py topics
```

Wiki pages live in `wiki/`. Use the search tool before asking the user to repeat
context that may already exist in memory.
