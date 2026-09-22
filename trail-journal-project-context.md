# Trail Journal — Project Context

## What This Is

A desktop app for hikers to consolidate all data captured on a trail day — GPS tracks, photos, journal notes, satellite messages — into a unified reconstruction interface that helps them write and eventually print a completed journal entry.

The original inspiration: a friend who thruhiked and wrote up journal entries after each day, then printed copies for her hiking companions. The goal is to make that process easier and eventually support printable output.

---

## Core Goals

### User Data Sovereignty

This was an explicit design constraint from the start. Key principles agreed on:

- **Local-first.** Data lives on the user's device by default. No cloud dependency.
- **Data minimization.** Only collect what's needed.
- **Portability.** Data should be exportable in open, usable formats — not proprietary blobs.
- **Real deletion.** Deleting data means deleting it everywhere.
- **No dark patterns.** Exiting the app or deleting data should be as easy as joining.
- **Granular, revocable consent** for any future sync/share features.

### The Core Use Case

A hiker finishes a long day on trail. They come home, import their GPS track, photos, and any satellite communicator messages into the app. The app builds a synchronized reconstruction of the day — a timeline and map view — so the hiker can scrub through what happened, where, and when, then write their journal entry with that full context available. Eventually they print it.

---

## Platform Decision: Electron Desktop App

### Why not native mobile

Mobile was considered and rejected as the primary platform for these reasons:

- The **reconstruction and writing workflow** (importing files, writing long journal entries, laying out printable output) is a desktop task, not a phone task.
- Most hikers **transfer GPS data from a Garmin device to a computer**, not directly to a phone. The file ingestion workflow is: GPS device → computer → app.
- **Printing** is a desktop workflow.
- App Store/Play Store distribution adds platform intermediaries that cut against the data sovereignty goals.

Mobile may become a **companion capture app** in the future — for mid-hike quick notes or GPS tracking if the hiker doesn't have a dedicated device. That companion would sync to the desktop app when they get home.

### Why Electron

- JavaScript across the full stack (matches developer's language).
- Local-first is straightforward — full Node.js file system access in the main process.
- Single portable SQLite database file the user owns and can back up.
- Cross-platform (Mac, Windows, Linux) without separate codebases.
- No App Store gatekeeping.

---

## Technical Architecture

### Electron's Two-Process Model

This is the most important concept for anyone new to Electron:

- **Main process** — runs Node.js. Has access to the file system, SQLite, native OS APIs. One instance.
- **Renderer process** — runs Chromium. This is the React UI. Sandboxed — cannot directly touch the file system or Node APIs.
- **IPC (inter-process communication)** — renderer asks main process to do anything system-level; main process does it and sends results back.

Do not disable the security sandbox. All file system and database access goes through the main process via IPC.

### Tech Stack

| Layer          | Choice                     | Reason                                               |
| -------------- | -------------------------- | ---------------------------------------------------- |
| App framework  | Electron + `electron-vite` | Modern boilerplate, handles build complexity         |
| UI             | React                      | Component model fits the timeline/map UI             |
| Local database | `better-sqlite3`           | Single portable `.db` file, relational queries, fast |
| Map rendering  | Leaflet or MapLibre GL     | GPX track visualization                              |
| GPS parsing    | `gpxparser` or custom      | GPX is XML, relatively simple                        |

### GPS Format Support

- **v1:** GPX only. Covers exports from Garmin devices, Gaia GPS, most phone tracking apps.
- **Future:** FIT (Garmin binary format), inReach CSV exports, SPOT XML, KML.

---

## Data Model

Everything anchors to two keys: **timestamp** and **coordinates**. These are the join keys across all data types. A photo taken at 2:34pm gets interpolated onto the GPS track at the position recorded at 2:34pm.

```sql
tracks
  id, name, date, gpx_raw, created_at

track_points
  id, track_id, lat, lng, elevation, timestamp

photos
  id, track_id, filepath, timestamp, lat, lng

journal_notes
  id, track_id, content, timestamp, lat, lng

messages
  id, track_id, content, timestamp, lat, lng, source
  -- source: 'inreach' | 'spot' | 'manual' etc.

entries
  id, track_id, full_text, created_at, updated_at
  -- the completed journal entry for this track day
```

### Known Data Hazards

- **EXIF timestamp alignment.** Camera timestamps use local device time; GPS tracks use UTC. App will need a timezone reconciliation step — surfaced to the user as "your photos appear offset by X hours from your track, correct?"
- **Track gaps.** GPS devices pause or lose signal. Interpolation logic needs to handle gaps gracefully.
- **Photo position interpolation.** Given a photo timestamp, find the two nearest track points and interpolate position between them.

---

## Primary UX Concept: The Reconstruction View

The core interface is a synchronized timeline + map view:

- Scrubbing the timeline moves a position marker along the GPS track on the map.
- Photos, journal notes, and satellite messages appear on the timeline at the time they were captured.
- Clicking any item shows its content.
- The journal entry is written alongside this view — hiker uses the reconstruction as memory aid, writes the entry themselves.

**The primary axis is time.** The map is secondary (position on track as a function of time). This decision should be preserved — apps that try to make space and time equal primaries end up cluttered.

---

## Deferred / Future Scope

- **Video support.** Explicitly cut from v1. Large files, compute-heavy processing, different engineering problem. Revisit after core is stable.
- **Printable output.** Core goal but not v1. User should eventually be able to design and print/export a formatted journal page combining the entry text, photos, and track map.
- **Mobile companion app.** Lightweight capture app for mid-hike notes. Syncs to desktop.
- **Additional GPS formats.** FIT, inReach CSV, SPOT XML, KML.
- **Cloud sync.** Opt-in only, never required. Out of scope until core local experience is solid.
- **Basemap tile hosting at scale.** The layer switcher (Topo/Satellite/Streets/USGS Topo) hits free public tile servers directly, which is fine at today's user count but not appropriate for wide distribution — see issue #36 for per-provider usage-policy notes and options (self-hosted tile cache, paid provider with an SLA) before that becomes a real user base.

---

## Developer Notes

- `electron-vite` is recommended over raw Electron boilerplate for first-time setup.
- `better-sqlite3` requires compilation against Electron's Node version — factor this into initial setup time.
- Budget time for Electron boilerplate confusion before any real app code gets written. It's front-loaded complexity.
