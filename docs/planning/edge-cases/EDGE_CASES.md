# AXOM Edge Case & Failure Mapping

This document maps "The Weird Stuff"—the rare but critical failure modes that crash apps during the first month of release.

## 1. The "Time Traveler" (Timezone/Clock Issues)
- **Scenario**: User changes system clock or travels across timezones during a study session.
- **Impact**: SRS `dueAt` dates become invalid; Pomodoro timers jump.
- **Mitigation**: Use `UTC` for all storage dates. Use a "Relative Offset" for timers instead of absolute timestamps.

## 2. The "Storage Full" (Disk Exhaustion)
- **Scenario**: User's device runs out of space.
- **Impact**: `IndexedDB` write fails; data corruption.
- **Mitigation**: Implement a `storageAvailable()` check before large imports. Wrap every `put` in a `try-catch` that triggers a "Storage Full" toast.

## 3. The "Sync Conflict" (Multi-Device)
- **Scenario**: User edits the same Anki card on two devices before syncing.
- **Impact**: Last-write-wins wipes the other's changes.
- **Mitigation**: Implement "Last-Modified-Wins" with a `conflict_log`. If a major conflict is detected, show a "Merge" modal (similar to Git).

## 4. The "Infinite Loop" (AI Hallucinations)
- **Scenario**: AI generates a JSON response that triggers a re-generation, creating a loop.
- **Impact**: API quota exhausted; app hangs.
- **Mitigation**: Hard cap on "Retry" attempts (max 3). Fallback to a "Human-Intervene" state if the AI fails to produce valid JSON thrice.

## 5. The "Zombie Process" (Tauri/Electron)
- **Scenario**: App is closed, but the background update process stays alive.
- **Impact**: Memory leak; CPU spikes.
- **Mitigation**: Implement a `heartbeat` mechanism between the UI and the Native Shell. If the UI dies, the shell kills all child processes.
