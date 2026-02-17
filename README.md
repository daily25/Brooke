# Brooke's Classroom

Classroom management app inspired by ClassDojo, upgraded with a gamified "ClassPro-style" layer for ages 10-12.

## What is included

- Teacher mobile-first console:
  - Class setup and student management with photos
  - Positive/negative skills and fast point actions
  - Season controls (start season, close season, close day)
  - Streak check-ins and streak freeze management
  - Store management including streak freeze consumables
  - Leaderboard mode sync controls (Top, Relative, Movement)

- Live display board:
  - Real-time points and leaderboard updates
  - Mode-aware leaderboards
  - Season progress, momentum card, and callout feed
  - Money and milestone sound cues (after one user tap to enable audio)

- Gamification engine:
  - XP and level progression
  - Season XP reward track and badge unlock events
  - Daily streak tracking with freeze consumption
  - Weekly movement deltas for growth-focused rankings

- Real-time sync:
  - Server-Sent Events for teacher/display state updates
  - Enriched event payloads for sounds, highlights, and display behavior

- Persistence and migration:
  - Local state in `data/state.json`
  - Automatic migration/backfill for legacy state files

## Run locally

```bash
cd brookes-classroom
npm start
```

Open:

- Teacher view: `http://localhost:3000/teacher`
- Display view: `http://localhost:3000/display`
- Student view (sample): `http://localhost:3000/student?code=OLIVR`
- Student view (sample): `http://localhost:3000/student?code=MILES`

Use the same server URL on both teacher phone and display device.

## Demo Data Included

This repo includes sample classroom data in `data/state.json` so you can demo immediately.

- Oliver sample student code: `OLIVR` (uses `/models/oliversmall.glb`)
- Miles sample student code: `MILES` (uses `/models/miles1.glb`)
- Miles model behavior: standing pose by default, use `Play Move` / `Pause Move` controls to run animation.

## New API endpoints

- `POST /api/season/start`
- `POST /api/season/close`
- `GET /api/leaderboard?mode=top|relative|movement&studentId=<id>`
- `POST /api/leaderboard/mode`
- `POST /api/streak/freeze/use`
- `POST /api/students/:id/streak/checkin`
- `POST /api/day/close`
