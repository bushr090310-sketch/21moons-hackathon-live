# 21MOONS Hackathon — Organizer Runbook

| Screen | URL | Who |
|---|---|---|
| Live leaderboard | `/` | everyone |
| Projector | `/display` | big screen (press the fullscreen button) |
| Challenges | `/challenges` | everyone |
| Team dashboard | `/team` | teams (team code) |
| People's Choice | `/vote` | participants (personal voting code) |
| Command center | `/admin` | organizers (`ADMIN_PASSWORD`) |

All times are Europe/Stockholm.

---

## HACKATHON MORNING — 5 MINUTE SETUP

1. **Open `/admin`** on your phone and sign in with the organizer password.
   If demo teams are still there: *Teams → Remove demo teams*.
2. **Teams register themselves** at `/team` → *Create new team* (team name + at least 2 names).
   They get their team login code and one voting code per person on screen (Copy all) and are
   signed in right away. Toggle it with *Control → Open / Close team registration*. When it is
   closed, existing teams can still log in.
   **Fallback / manual:** *Control → + Add team*. Type the team name.
3. **Add participant names**, one per line, then **Save team & generate codes**.
4. **Give teams their codes.** The card that pops up shows the TEAM LOGIN CODE and
   one VOTING CODE per person. Codes are shown **only once**: press **Print** or **Copy all**
   before closing. If a code is lost, use *New team code* or *Voting codes* on the team card.
5. **Confirm the screens:** open `/display` on the projector and click fullscreen.
   Check that the Live pill is green.
6. **Confirm challenges:** *Challenges* tab. The 8 ground challenges and the finals are
   scheduled for 09:00; drops at 11:00, 13:00, 14:00 and 15:00 reveal on their own.
   Configure the 🎯 Secret Challenge (Edit), and leave it as a Draft until you want to drop it.
7. **Start the event:** at 09:00 everything scheduled appears with a CHALLENGE DROP
   animation. To start earlier or later: *Control → Drop challenge → Drop now*, or edit the reveal times.

## DURING EVENT

- **Review applications:** the *Inbox* badge counts pending applications. A toast appears for each
  NEW APPLICATION (turn on the bell for sound). Oldest applications come first.
- **Approve / Reject:** Approve adds the points to the ledger right away. Reject needs a reason,
  which the team sees before they reapply.
  - **FIRST challenges:** you cannot approve a later application while an earlier one is pending.
    The card says who is first in line. Approving the winner locks the challenge and auto-rejects
    the others ("Claimed first by …").
  - **Revenue Rush (repeatable):** pick 1 or 2 awards. The cap is enforced.
  - **Competitive entries** (Most Revenue, Content War, …): *Verify entry* only makes the entry
    eligible. Enter the verified value there. No points are awarded until finalization.
- **Activate a challenge:** *Control → Drop challenge*, or *Challenges → Activate now*.
- **Undo a mistake:** on an approved card, press *Revoke*. This adds a compensating entry;
  history is never deleted.
- **Freeze board** / **Voting** / **Final awards:** see below.

## FINAL 30 MINUTES

1. **Close submissions** where needed. Competitive challenges expire at 18:00 on their own.
   *Settings → Accept applications* pauses everything at once.
2. **Freeze the public board:** *Control → Freeze leaderboard*. Public screens and teams stop
   seeing new points. You still see the real leaderboard and can keep approving.
3. **Finalize competitive awards:** *Challenges → Final awards → Finalize*. Entries are ranked by
   their verified value. Pick the winner (or several, for an explicit shared award).
4. **People's Choice:** *Voting → Open voting* (participants go to `/vote`), then *Close voting*,
   then *Finalize*. On a tie **nothing is awarded automatically**: pick a run-off winner or
   declare co-winners.
5. **Award jury challenges:** *Challenges → Final awards → Finalize* for Best Product, Best Pitch,
   Best Landing Page, Content King and Funniest Marketing.
6. **Reveal:** *Control → Reveal final board*. Every screen plays the reveal and shows the real scores.

## EMERGENCY

- **Manual score adjustment:** *Scores*. Pick the team, enter +/- points and a required reason.
  The public label defaults to "Organizer correction/bonus". To undo any entry, use ↶ (reverse).
- **Realtime failure:** nothing to do. Every screen also polls every 5–10 s and reconnects
  on its own. The pill turns amber ("Reconnecting") only if the server is unreachable.
  If a screen looks stuck, reload it.
- **Frozen by mistake:** *Settings → Unfreeze quietly* (unfreezes without the reveal animation).
- **Export data:** *Settings → Export* (full JSON, or CSV per dataset), or *Control → Export event data*.
  Take one export at lunch and one before the reveal.
- **Team can't log in:** use *New team code* on its card. This also signs out old devices.
- **Lost voting code:** use the 🔑 icon next to the participant.

## Rules the system enforces (server-side)

- Points only change through the append-only `score_ledger`; the database rejects edits and deletes.
- FIRST: the earliest pending application must be resolved first. Locks after the winning approval.
- ONCE: one award per team. REPEATABLE: per-team cap. Expired or locked challenges reject applications.
- Team identity comes from a signed HttpOnly cookie, never from the request.
- Votes: one per participant (DB unique constraint) and never for your own team (DB trigger).
- Evidence sits in a private bucket and is served to organizers only, through 2-minute signed URLs.
- Secret or unrevealed challenges never leave the database for public or team requests.
