# 21. Feedback and bug reports

**Status: DRAFT, for review. Nothing here is built.**

A button in the app that files a bug report or a feedback item as a GitHub issue,
carrying enough context that the report is actionable without a conversation.

---

## 21.1 The problem it solves

Every defect found today was found by someone who could read the database, run
the ingest and diff the corpus. A player cannot do any of that. Their report is
"the land count looked wrong", and by the time anyone asks which deck, which
width, and which corpus snapshot, the moment has passed.

**The value of this feature is almost entirely in the context it attaches, not
in the text box.** A text box already exists — it is called GitHub, and nobody
uses it from inside a deck.

---

## 21.2 What the report carries

Automatically, without asking:

| Field | Why |
|---|---|
| `datasetSnapshotId` | The corpus the user was looking at. Half of today's "bugs" were a stale snapshot. |
| Deployed commit SHA | Which build. The client knows it; the health endpoint has it. |
| Deck id and commander | Reproduction starts here. |
| Viewport width, and which layout was active | Three column, four column, or the mobile sheet — layout bugs are width-specific and users never say. |
| `lw.deviceId` (ADR-0014) | Correlates repeat reports from one browser without identifying a person. |
| The active filter and sort | A "wrong recommendation" is usually a filter the user forgot. |
| Last few commands from the deck command log (ADR-0020) | What they just did. This is the single most valuable field. |

Plus the user's own words, and a type: **bug** or **feedback**.

**Not carried:** anything the user did not type and cannot see. See §21.6.

---

## 21.3 Decisions this spec makes

### D1. The token never reaches the browser

The GitHub token lives on the server. The client posts to our own API, which
creates the issue. A token in client code is a token in every user's devtools,
and a repo-scoped token can delete branches.

This is not negotiable and it decides the shape: **`POST /api/v1/feedback`**, a
new endpoint, with the token in the server's environment beside the Neon
credentials.

### D2. Rate limited, per device

An unauthenticated endpoint that creates GitHub issues is an endpoint that fills
the repo with issues. Limit per `deviceId` and in total. On exceeding it, say so
plainly — a silent drop teaches the user the button does nothing.

### D3. The user sees exactly what is sent, before it sends

The context in §21.2 is shown in the dialog, in plain words, with the report.
Not a checkbox they will not read — the actual values. A user who does not want
to send their deck id should be able to see that it is going.

Rejected: sending silently because the fields are innocuous. They are innocuous
*because* they were chosen to be; the way that stays true is by showing them.

### D4. It degrades to a link

If the API is unreachable — which is exactly when someone most wants to report a
bug — the dialog offers a prefilled GitHub issue URL the user can open
themselves. A feedback button that fails when the app is broken is a feedback
button that never sees the reports that matter.

### D5. Labels, not free-form triage

`bug` or `feedback` from the user, plus `from-app` applied by the server so
these are distinguishable from issues filed by hand. The server sets the labels;
the client does not choose them beyond the type.

---

## 21.4 Where the button lives

The masthead row currently holds **Graph, Quickbuild, Help**, with Import and
Export behind an overflow menu (ADR-0032, ADR-0033). It was measured at 1175px
for exactly that shape, and a fourth button changes that derivation.

**Proposed: in the overflow menu**, beside Import and Export. Feedback is not a
working tool — it is pressed rarely, and unlike Help it is not the escape hatch
for a first-time user who lost the tour.

**Open question Q1** covers whether that is too well hidden for a thing we want
people to press.

---

## 21.5 Open questions

**Q1. Menu or masthead?** The menu keeps the row honest and the 1175px
derivation intact. But a bug report button nobody finds collects nothing, and
this feature's whole value is volume. A third option: in the menu *and* on the
error boundary's fallback panel, where a user is already looking at something
broken.

**Q2. Does it need a server change beyond the endpoint?** The command log is
server-side; the client may not hold the last few commands in a form worth
sending. Check before assuming §21.2's most valuable field is free.

**Q3. What stops abuse?** D2 says rate limit, but an unauthenticated public
endpoint that writes to a repo is a real surface. Options: a shared secret in
the app bundle (weak, but stops drive-by), server-side moderation queue rather
than direct issue creation, or accepting the risk while the user base is one
person.

**Q4. Screenshot?** A layout bug is far easier to see than to describe. The
browser can capture the viewport, but it inflates the payload and can capture
anything on screen. Probably not in a first version — but it is the field that
would have made several of today's findings self-evident.

**Q5. Does a report include the deck?** A deck id is useless to anyone without
database access. The full decklist is actionable and is also the user's work.
Ask them, or attach the commander and card count only.

---

## 21.6 Privacy

- Nothing is sent that the user cannot see in the dialog (D3).
- `deviceId` is a random per-browser id (ADR-0014), not a person.
- No deck contents beyond what Q5 settles.
- No automatic capture of anything from another tab, the clipboard, or storage
  beyond the two keys named here.

---

## 21.7 Accessibility (R4) — binding

- The dialog traps focus, returns it to the opener, and closes on Escape.
- The type choice is a real radio group, not two coloured buttons.
- Submission state — sending, sent, failed — is announced to a live region, not
  conveyed by a spinner alone.
- The prefilled-link fallback (D4) is a real link, keyboard reachable.

---

## 21.8 Out of scope

- Viewing or replying to existing reports in the app.
- Attaching logs or console output.
- Any form of user account or authentication.
