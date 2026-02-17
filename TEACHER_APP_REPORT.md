# Brooke's Classroom Teacher Guide

## 1. Purpose Of This App
Brooke's Classroom is a classroom behavior and motivation system built for ages 10-12.  
It gives the teacher a mobile-friendly control panel and a live display board that updates instantly.

The app is designed around:
1. Positive behavior tracking and point adjustments.
2. Gamified growth (XP, levels, badges, streaks, seasons).
3. A classroom store with redemption.
4. Live public display views.
5. Student profile access by teacher-issued 5-letter codes.
6. Student shoutout submissions that require teacher moderation.

---

## 2. Core Roles And Views

### Teacher View
URL: `/teacher`  
Used on phone/tablet for setup and full control.

### Display Views
URL: `/display` (Home)  
URL: `/display-store` (Store-only)  
URL: `/display-leaderboards` (Leaderboards-only)  
Used on projector/TV/class screen. Updates in real time.

### Student Character Page
URL: `/student`  
Students enter a 5-letter access code to open only their own profile.

---

## 3. Getting Started

1. Start the server from the project folder:
```bash
npm run dev
```
2. Open the same server URL on each device.
3. On teacher phone, open `/teacher`.
4. On class display, open `/display`.
5. For student devices, use `/student` and provide each student their access code.

Note:
1. There is no account login system in this phase.
2. Anyone with the server URL can access teacher controls, so use trusted networks/devices.

---

## 4. Teacher View: Full Feature Walkthrough

## 4.1 Class Setup
Section: **Class Setup**

1. Enter class name.
2. Click `Save`.
3. This name syncs to all display and student views.

## 4.2 Season And Display Controls
Section: **Season And Display Controls**

1. Start Season:
   - Enter season name (optional).
   - Choose season length in days (default 42).
   - Click `Start Season`.
2. Close Season:
   - Click `Close Season` to archive current season.
3. Close Day:
   - Click `Close Day` to process missed-day streak logic.
4. Leaderboard Sync Mode:
   - Choose mode: `Top`, `Relative`, or `Movement`.
   - For `Relative`, pick a focus student.
   - Click `Sync Mode`.

Note:
1. The dedicated leaderboard display page always shows multiple boards.
2. Sync mode is retained for real-time state and compatibility behavior.

## 4.3 Add Student
Section: **Add Student**

1. Enter full student name.
2. Optionally upload student photo.
3. Click `Add Student`.

System behavior:
1. Each student receives a unique 5-letter access code automatically.
2. Streak freezes initialize from season defaults.

## 4.4 Students Grid
Section: **Students**

Each card shows:
1. Name and avatar/photo.
2. Current level.
3. Current streak.
4. Verification badge (`V`) if consistency threshold is met.
5. Total points.

Tap a student card to open the student control sheet.

## 4.5 Student Access Codes
Section: **Student Access Codes**

Each row shows:
1. Student name.
2. 5-letter code.
3. Quick student URL pattern (`/student?code=XXXXX`).

Buttons:
1. `Copy Code` copies only the code.
2. `Copy Link` copies full profile URL.
3. `New Code` regenerates the student code immediately.

Best practice:
1. Treat codes like temporary class passcodes.
2. Regenerate if shared incorrectly.

## 4.6 Shoutout Inbox
Section: **Shoutout Inbox**

Students can submit peer shoutouts (reason text) for teacher moderation.

Filter options:
1. Pending
2. Approved
3. Archived
4. All

Actions:
1. `Approve` marks shoutout approved and creates a class event.
2. `Archive` stores it without approving.
3. `Delete` removes it permanently.

Important:
1. Approving a shoutout does not automatically add points.
2. If you want points awarded, use student sheet actions after approval.

## 4.7 Student Sheet (Tap Any Student)
Tabs include:
1. Positive
2. Needs Work
3. Season
4. Store
5. History

Header shows:
1. Student points.
2. Student level.
3. Current access code.

### Positive / Needs Work Tab
1. Tap skills to apply point changes immediately.
2. Use `Quick Adjust` buttons for fast +1, -1, +3 actions.
3. Add custom skills quickly with icon and point value.

### Season Tab
1. View season XP progress bar.
2. View streak line: current, best, freezes.
3. `Check In` manually records streak check-in.
4. `Use Freeze` consumes one freeze.
5. Reward track shows lock/unlock status by XP threshold.

### Store Tab
1. Redeem available items for this student.
2. Applies cost and stock changes immediately.

### History Tab
1. Shows recent student events and point deltas.

## 4.8 Skill Library
Section: **Skill Library**

1. Build positive and negative behavior skills.
2. Set icon shorthand and point values.
3. Delete outdated skills as needed.

## 4.9 Class Store
Section: **Class Store**

1. Add standard items or streak freeze items.
2. Set cost and stock.
3. For streak freeze type, set freeze quantity.
4. Delete items as needed.

---

## 5. Display Views: What Students See

All display pages include:
1. `Live Sync` connection indicator.
2. Theme toggle (`Light Mode` / `Dark Mode`).
3. Persistent footer navigation:
   - `Home`
   - `Store`
   - `Leaderboards`

## 5.1 Home Display (`/display`)
Shows:
1. Class points grid.
2. Recent activity feed on the right.

Behavior:
1. Teacher actions update instantly.
2. Positive point actions trigger money sound cue (`kaching.mp3`) by default.
3. Highlight/celebration animations trigger for milestone events.
4. Sound is default-on but may need first user interaction due browser policy.

## 5.2 Store Display (`/display-store`)
Shows:
1. Store item list only.
2. Cost, stock status, and item type.

## 5.3 Leaderboards Display (`/display-leaderboards`)
Shows four boards at once:
1. Top Points
2. Weekly Movement
3. Current Streak
4. Level And XP

---

## 6. Student Character Page And Access Codes

URL: `/student`

## 6.1 Student Access Flow
1. Student enters 5-letter code.
2. App resolves code to exactly one student profile.
3. Student sees only their own character page data.

Profile shows:
1. Avatar area.
2. Stats (points, rank, XP, level, streak, freezes, verification).
3. Skill totals.
4. Badges and streak summary.
5. Recent activity.

## 6.2 3D Avatar Support
If a student has an `avatarModel` path set (example: `/models/oliver.glb`), the profile renders an interactive 3D model instead of static photo.

Current dummy data includes:
1. Student `Oliver`
2. Access code `OLIVR` (unless teacher resets it)
3. 3D model path `/models/oliver.glb`

## 6.3 Student Shoutout Submission
On their own profile page, a student can:
1. Click `Shoutout A Classmate`.
2. Choose a classmate.
3. Enter why that classmate deserves recognition.
4. Submit to teacher.

Teacher must then:
1. Approve
2. Archive
3. Delete

---

## 7. Gamification Logic Explained

## 7.1 Points To XP
1. Positive points add XP (default 10 XP per +1 point).
2. Negative points default to 0 XP gain.
3. XP contributes to level progression.

## 7.2 Levels
Default thresholds:
1. Level 1: 0 XP
2. Level 2: 50 XP
3. Level 3: 120 XP
4. Level 4: 210 XP
5. Level 5: 320 XP
6. Level 6: 450 XP
7. Level 7: 600 XP

## 7.3 Rewards Track
Students unlock badge milestones as season XP increases.  
Unlocks happen once per reward threshold.

## 7.4 Streaks And Freezes
1. Check-ins and activity maintain streaks.
2. Missed school days consume freeze when available.
3. If no freeze is available, streak resets.
4. Best streak is preserved as historical high.

## 7.5 Verified Status
Verification badge is rule-based consistency status (not a financial score).

## 7.6 Seasons
1. Season has start date, end date, and length.
2. Closing/rolling season archives season snapshot.
3. Seasonal counters reset while preserving core student records.

---

## 8. Live Sync Behavior

Live updates are pushed through server-sent events (SSE).

Any teacher action can update:
1. Teacher view
2. Display views
3. Student views

Examples:
1. Awarding points updates class cards and activity feed instantly.
2. Season changes propagate immediately.
3. Shoutout moderation status updates in real time.

---

## 9. Sound And Theme

## 9.1 Sound
1. Home display defaults to sound enabled.
2. Positive point events use `kaching.mp3`.
3. If browser blocks autoplay, first click/tap unlocks audio.

## 9.2 Theme
1. Teacher and display pages have light/dark toggle.
2. Theme preference is stored locally in browser storage.
3. Student page follows stored theme if already set on that device.

---

## 10. Recommended Daily Routine For Teachers

1. Open `/teacher` on phone.
2. Confirm class name and season state.
3. Check student list and access codes.
4. Keep `/display` open on class screen.
5. Award behaviors during lessons from student sheet actions.
6. Use store tab for redemptions.
7. Review shoutouts during transition or end of day.
8. Run `Close Day` after class if using streak discipline consistently.

---

## 11. Troubleshooting

## 11.1 Live Sync Not Updating
1. Check `Live Sync`/`Reconnecting` indicator.
2. Ensure teacher and display use same server URL.
3. Refresh affected page.
4. Confirm server is still running.

## 11.2 Sound Not Playing
1. Click/tap once on display page to unlock audio.
2. Confirm `Sound Enabled` button state.
3. Check browser/site volume permissions.

## 11.3 Student Code Not Working
1. Verify exact 5 letters.
2. Check if code was regenerated by teacher.
3. Use `New Code` in teacher panel and redistribute.

## 11.4 Shoutouts Not Appearing
1. Confirm student submitted from code-authenticated page.
2. Check teacher filter is on `Pending` or `All`.
3. Refresh teacher page if network briefly dropped.

## 11.5 3D Model Not Showing
1. Confirm model path is valid and inside `/public/models`.
2. Verify `.glb` file exists and serves at `/models/<name>.glb`.
3. If network blocks external scripts, `model-viewer` may fail to load.

---

## 12. Data Notes

1. App state is persisted in `data/state.json`.
2. Includes students, points, events, shoutouts, seasons, and store.
3. New schema fields are migrated automatically on boot.
4. Existing class data is preserved during migration.

---

## 13. Teacher-Facing Summary

This app gives you a complete classroom engagement loop:
1. Add students with real names and optional photos.
2. Award/deduct behavior points quickly during class.
3. Motivate with levels, streaks, badges, and store rewards.
4. Keep students engaged with live public views.
5. Let students submit peer shoutouts while you stay in control through moderation.
6. Give each student private profile access using a simple 5-letter code.

If you run the teacher view daily and keep the display open during lessons, the system is ready for full classroom use.
