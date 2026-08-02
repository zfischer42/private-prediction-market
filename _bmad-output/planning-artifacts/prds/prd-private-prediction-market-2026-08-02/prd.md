---
title: Private Prediction Market
status: draft
created: 2026-08-02
updated: 2026-08-02
---

# PRD: Private Prediction Market
*Working title — confirm.*

## 0. Document Purpose
This PRD is for product, implementation, and downstream planning owners who need a clear definition of the first version of a private, invite-only prediction market for friends. It structures the product around user journeys, feature groups, and testable requirements, while keeping implementation choices out of the product scope unless they are hard constraints. A separate epic breakdown and story files live alongside this document in the same run folder.

## 1. Vision
Private Prediction Market is a lightweight place for friends to create, join, and resolve playful bets around future events. The product turns casual group forecasting into a shared experience that feels organized, legible, and easy to return to on mobile.

The product needs to feel private by default, simple to set up, and trustworthy enough that one designated organizer can manage the group without becoming a bottleneck. Users should be able to create a market, invite friends, record bets, and see outcomes and standings without needing spreadsheets, group chats, or manual bookkeeping.

This is a hobby-scope product, so the first version should optimize for a tight loop: create a private space, add markets, place bets, resolve outcomes, and review standings. [ASSUMPTION: v1 tracks bets and settlements inside the app, but does not move real money on behalf of users.]

## 2. Target User

### 2.1 Jobs To Be Done
- Create a private betting space for a small group of friends.
- Invite people quickly without exposing the group publicly.
- Make it easy to add bets and keep them organized.
- Let one trusted organizer manage setup and resolution.
- See who is winning without manual tallying.
- Use the product comfortably from a phone.

### 2.2 Non-Users (v1)
- Public, open-market traders.
- Users looking for automated real-money wagering.
- Large tournament operators or enterprise contest organizers.
- People who need advanced regulatory or compliance features in v1.

### 2.3 Key User Journeys
- **UJ-1. Host creates a private betting space.**
  - **Persona + context:** Casey wants to start a small group bet for a friend circle.
  - **Entry state:** Casey is on mobile, signed in, and has not created a space yet.
  - **Path:** Casey creates a space, names it, chooses the organizer role, and invites friends.
  - **Climax:** The space exists and the invite link is ready to share.
  - **Resolution:** Casey lands on the empty space dashboard and can add the first market.

- **UJ-2. Friend joins and places a bet.**
  - **Persona + context:** Jordan receives an invite and wants to participate without friction.
  - **Entry state:** Jordan opens the app from an invite link on a phone.
  - **Path:** Jordan accepts the invite, joins the space, opens a market, reviews options, and places a bet.
  - **Climax:** The bet is recorded and visible in the market history.
  - **Resolution:** Jordan sees the market status and can return later to check results.

- **UJ-3. Organizer resolves the market and everyone sees the outcome.**
  - **Persona + context:** Casey needs to close the loop after the event happens.
  - **Entry state:** The market has reached its resolution point.
  - **Path:** Casey opens the market, records the outcome, and confirms the result.
  - **Climax:** The market updates to resolved and standings recalculate.
  - **Resolution:** Everyone sees the final result, their position, and the group history.

## 3. Glossary
- **Space** — A private invite-only group for one friend circle or organizer.
- **Organizer** — The trusted person who creates spaces, adds markets, and resolves outcomes.
- **Market** — A bet topic with a question, possible outcomes, and a closing or resolution time.
- **Bet** — A participant’s selected outcome and stake on a market.
- **Settlement** — The recorded final result of a market and the resulting win/loss state.
- **Standing** — The current summary of participant performance within a space.

## 4. Features

### 4.1 Private Spaces and Membership
**Description:** Users create invite-only spaces for a specific group of friends. The space acts as the boundary for membership, markets, bets, and standings. The product must keep spaces private by default and make the join path simple on mobile. Realizes UJ-1 and UJ-2. [ASSUMPTION: membership is limited to invited users or users who accept an invite link.]

**Functional Requirements:**

#### FR-1: Create a private space
An authenticated user can create a new private space with a name and organizer role.

**Consequences (testable):**
- The new space appears in the creator’s workspace immediately after creation.
- The creator is assigned organizer permissions for that space.

#### FR-2: Invite members to a space
An organizer can generate and share an invite mechanism that allows other users to join the space.

**Consequences (testable):**
- Invite access is scoped to the target space only.
- A joined member appears in the space membership list after acceptance.

#### FR-3: Join a space from an invite
A user can accept an invite and join a space on first visit or after sign-in.

**Consequences (testable):**
- The user sees the correct space after acceptance.
- Users who are not invited cannot join by guessing a space identifier.

### 4.2 Market Creation and Management
**Description:** Organizers create markets that define the question being bet on, the possible outcomes, and the market timing. Markets need to be easy to read, quick to create, and obvious when open, closed, or resolved. Realizes UJ-1 and UJ-3.

**Functional Requirements:**

#### FR-4: Create a market
An organizer can create a market inside a space with a question, outcome options, and a closure or resolution rule.

**Consequences (testable):**
- The market is visible to all members of the space.
- The market has a status that changes over its lifecycle.

#### FR-5: Close market participation
The system prevents new bets from being placed after a market is closed.

**Consequences (testable):**
- Closed markets do not accept new bets.
- The UI clearly indicates that the market is closed.

#### FR-6: Edit or retire a draft market
An organizer can update or remove a market before it is opened to participants.

**Consequences (testable):**
- Draft markets can be corrected without affecting participant records.
- Once bets exist, destructive edits are blocked or constrained.

### 4.3 Bets and Participation
**Description:** Members place bets against the available market outcomes and can return later to see their own history and the market’s current state. The product should make the betting action clear and fast on mobile. Realizes UJ-2.

**Functional Requirements:**

#### FR-7: Place a bet
A space member can place a bet on an open market by selecting an outcome and a stake.

**Consequences (testable):**
- The bet appears in the member’s history.
- The market reflects the new bet immediately after save.

#### FR-8: Review bet history
A space member can view their own bet history within a space.

**Consequences (testable):**
- The user can see past bets, current status, and final outcomes.
- History is scoped to the selected space.

#### FR-9: Prevent invalid bets
The system blocks bets that violate market timing or membership rules.

**Consequences (testable):**
- Non-members cannot bet in the space.
- Users cannot place bets on closed markets.

### 4.4 Resolution and Standings
**Description:** The organizer resolves a market after the event and the app recalculates the result for the space. This is the trust anchor for the product, so the resolution flow must be obvious and auditable. Realizes UJ-3.

**Functional Requirements:**

#### FR-10: Resolve a market
An organizer can mark a market as resolved and assign the final outcome.

**Consequences (testable):**
- The market status changes to resolved.
- Final results are visible to all members.

#### FR-11: Recalculate standings
The system updates space standings after resolution.

**Consequences (testable):**
- Standing totals change when the market outcome is recorded.
- Historical results remain viewable after the update.

#### FR-12: Show resolution history
A member can review previous markets, outcomes, and personal results.

**Consequences (testable):**
- Resolved markets stay accessible in history.
- A user can see which outcomes they picked and whether they won or lost.

### 4.5 Mobile PWA Experience
**Description:** The product should feel native on a phone, install cleanly as a PWA, and remain useful even when connectivity is imperfect. The experience should emphasize fast access to current spaces and markets. Realizes UJ-1, UJ-2, and UJ-3.

**Functional Requirements:**

#### FR-13: Install as a PWA
The web app can be installed from the browser as a PWA.

**Consequences (testable):**
- The app presents an installable experience on supported browsers.
- Installed app launches in a standalone window.

#### FR-14: Support mobile-first layouts
The interface adapts to small screens without requiring desktop-only interactions.

**Consequences (testable):**
- Core actions remain usable on a typical phone viewport.
- No primary flow requires hover-only behavior.

#### FR-15: Preserve recent reading when offline
The app can show recently loaded spaces or markets when the network is unavailable.

**Consequences (testable):**
- Users can still read recently cached content offline.
- The app clearly marks actions that require connectivity.

## 5. Non-Goals (Explicit)
- Public or open prediction markets.
- Automated custody or transfer of real money.
- Complex trading mechanics, liquidity, or pricing engines.
- Enterprise compliance packages in v1.
- Advanced analytics dashboards beyond basic standings and history.
- Multi-language support in the first release.

## 6. MVP Scope

### 6.1 In Scope
- Invite-only spaces for friends.
- Organizer-created markets.
- Bet placement and bet history.
- Manual market resolution.
- Standings and history views.
- Mobile-first PWA shell.

### 6.2 Out of Scope for MVP
- Public discovery or browsing.
- Real-money transfer handling.
- Automated dispute resolution.
- Native mobile apps.
- Deep integrations with payment processors or external identity providers.

## 7. Success Metrics

**Primary**
- **SM-1**: A new user can join a space and place a first bet in one session. Validates FR-1 through FR-7.
- **SM-2**: At least one market can be created, resolved, and reflected in standings without manual admin recalculation. Validates FR-4, FR-10, and FR-11.

**Secondary**
- **SM-3**: Members return to check market status or standings in later sessions. Validates FR-8 and FR-12.
- **SM-4**: The app is frequently accessed from mobile after installation. Validates FR-13 and FR-14.

**Counter-metrics (do not optimize)**
- **SM-C1**: Do not optimize for large group scale before the core friend-circle loop is working.
- **SM-C2**: Do not optimize for maximum trading complexity if it makes the first bet slower.

## 8. Open Questions
1. Are bets tracked as points, tokens, or real-money obligations?
2. Should invite links be single-use, expiring, or reusable?
3. Do members need the ability to edit or cancel their own bets before closure?
4. Should the organizer be the only person allowed to resolve markets?
5. Do we need notifications for market closure or resolution in v1?

## 9. Assumptions Index
- [ASSUMPTION] v1 tracks bets and settlements in-app, but does not move real money on behalf of users.
- [ASSUMPTION] Membership is limited to invited users or users who accept an invite link.
