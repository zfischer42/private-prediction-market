---
stepsCompleted: []
inputDocuments:
  - prd.md
---

# Private Prediction Market - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Private Prediction Market, decomposing the requirements from the PRD into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR-1: An authenticated user can create a new private space with a name and organizer role.
- FR-2: An organizer can generate and share an invite mechanism that allows other users to join the space.
- FR-3: A user can accept an invite and join a space on first visit or after sign-in.
- FR-4: An organizer can create a market inside a space with a question, outcome options, and a closure or resolution rule.
- FR-5: The system prevents new bets from being placed after a market is closed.
- FR-6: An organizer can update or remove a market before it is opened to participants.
- FR-7: A space member can place a bet on an open market by selecting an outcome and a stake.
- FR-8: A space member can view their own bet history within a space.
- FR-9: The system blocks bets that violate market timing or membership rules.
- FR-10: An organizer can mark a market as resolved and assign the final outcome.
- FR-11: The system updates space standings after resolution.
- FR-12: A member can review previous markets, outcomes, and personal results.
- FR-13: The web app can be installed from the browser as a PWA.
- FR-14: The interface adapts to small screens without requiring desktop-only interactions.
- FR-15: The app can show recently loaded spaces or markets when the network is unavailable.

### NonFunctional Requirements

- NFR-1: The app must keep private spaces private by default.
- NFR-2: The app must be mobile-first and usable on a typical phone viewport.
- NFR-3: The app must be understandable without hover-only interactions.
- NFR-4: Offline behavior must clearly distinguish cached read-only views from network-dependent actions.
- NFR-5: The app must remain lightweight enough that the core create/join/bet/resolve loop feels fast for hobby use.

### Additional Requirements

- The first version should favor a small, friend-circle workflow over public-market scale.
- The product should support installable PWA behavior from the outset.
- Manual resolution is acceptable for v1; automated money movement is not required.
- The implementation should support a private invite-only boundary across the product.

### UX Design Requirements

- None provided yet.

### FR Coverage Map

- Epic 1 covers FR-13, FR-14, and FR-15.
- Epic 2 covers FR-1, FR-2, and FR-3.
- Epic 3 covers FR-4, FR-5, and FR-6.
- Epic 4 covers FR-7, FR-8, and FR-9.
- Epic 5 covers FR-10, FR-11, and FR-12.

## Epic List

- Epic 1: Foundation and PWA shell
- Epic 2: Private spaces and invites
- Epic 3: Markets and market lifecycle
- Epic 4: Bets and participant history
- Epic 5: Resolution and standings

## Epic 1: Foundation and PWA shell

Build the monorepo application foundation, shared config, and installable mobile-first web shell so the rest of the product can iterate safely.

### Story 1.1: Create the monorepo workspace and app/package layout

As a developer,
I want the project organized into web, api, shared, and Supabase-related packages,
So that the product can scale without mixing browser, server, and data concerns.

**Acceptance Criteria:**

**Given** the repository is initialized
**When** I inspect the workspace structure
**Then** I see separate locations for the web app, API, shared packages, and Supabase assets
**And** the workspace has a repeatable way to run the apps locally

### Story 1.2: Add the baseline PWA shell and mobile-first navigation

As a user,
I want the app to open cleanly on mobile and install like a PWA,
So that I can return to it from my home screen.

**Acceptance Criteria:**

**Given** I open the web app on a supported browser
**When** the app loads on a phone-sized viewport
**Then** the primary navigation and core actions are usable without desktop-only interactions
**And** the app presents an installable PWA experience where supported

### Story 1.3: Define shared app-wide states and empty screens

As a user,
I want clear empty, loading, and offline states,
So that I always understand what the app can do next.

**Acceptance Criteria:**

**Given** I am on an empty or loading screen
**When** the app has no data or no network
**Then** I see a clear state message and a next action or limitation
**And** cached read-only content is visually distinct from network actions

## Epic 2: Private spaces and invites

Enable the organizer to create a private group and bring friends into it safely.

### Story 2.1: Create a private space

As an organizer,
I want to create a private space with a name,
So that I can organize bets for a specific group of friends.

**Acceptance Criteria:**

**Given** I am signed in
**When** I create a new space
**Then** I become the organizer of that space
**And** the space appears in my workspace immediately

### Story 2.2: Invite friends into a space

As an organizer,
I want to generate an invite link or invite flow,
So that friends can join the private space without public discovery.

**Acceptance Criteria:**

**Given** I am the organizer of a space
**When** I invite a friend
**Then** the invite is scoped to that space only
**And** an invited user can join through the invite path

### Story 2.3: Join a space from an invite

As an invited user,
I want to join a space from an invite link,
So that I can participate without manual setup.

**Acceptance Criteria:**

**Given** I have a valid invite
**When** I accept it
**Then** I join the correct space
**And** I cannot join spaces I was not invited to

## Epic 3: Markets and market lifecycle

Let organizers create and manage the bets that the space will track.

### Story 3.1: Create a market

As an organizer,
I want to create a market with a question and outcomes,
So that members have a clear thing to bet on.

**Acceptance Criteria:**

**Given** I am inside a space
**When** I create a market
**Then** the market is visible to members of that space
**And** it has a clear open or draft state

### Story 3.2: Edit or retire a draft market

As an organizer,
I want to adjust a draft market before bets are placed,
So that I can correct mistakes without affecting history.

**Acceptance Criteria:**

**Given** no bets have been placed yet
**When** I update or remove the draft market
**Then** the change is allowed
**And** participant history is not affected

### Story 3.3: Close a market to new bets

As an organizer,
I want a market to stop accepting new bets after closure,
So that the result is fair and predictable.

**Acceptance Criteria:**

**Given** a market is closed
**When** a member attempts to place a new bet
**Then** the system rejects the bet
**And** the UI clearly shows the market is closed

## Epic 4: Bets and participant history

Let members place bets and review their own history in the space.

### Story 4.1: Place a bet on an open market

As a member,
I want to place a bet on an open market,
So that I can participate in the group prediction.

**Acceptance Criteria:**

**Given** I am a member of the space
**And** the market is open
**When** I submit a bet with an outcome and stake
**Then** the bet is recorded for me
**And** the market reflects the new bet immediately

### Story 4.2: View my bet history in a space

As a member,
I want to view my bet history,
So that I can remember what I picked and how I performed.

**Acceptance Criteria:**

**Given** I am inside a space
**When** I open my history
**Then** I can see past bets, current status, and final results

### Story 4.3: Block invalid bet submissions

As the system,
I want to prevent invalid bets,
So that only eligible members can participate in open markets.

**Acceptance Criteria:**

**Given** I am not a member or the market is closed
**When** I try to place a bet
**Then** the system blocks the action
**And** the response explains why the bet was rejected

## Epic 5: Resolution and standings

Let the organizer resolve outcomes and let the space see who is ahead.

### Story 5.1: Resolve a market

As an organizer,
I want to mark a market as resolved,
So that the group has a final outcome.

**Acceptance Criteria:**

**Given** the market is ready for resolution
**When** I assign the final outcome
**Then** the market becomes resolved
**And** all members can see the result

### Story 5.2: Recalculate standings after resolution

As the system,
I want to update standings when a market is resolved,
So that the space leaderboard stays current.

**Acceptance Criteria:**

**Given** a market outcome is recorded
**When** standings refresh
**Then** the totals reflect the outcome
**And** historical results remain available

### Story 5.3: Review past markets and outcomes

As a member,
I want to review previous markets,
So that I can understand my history in the group.

**Acceptance Criteria:**

**Given** I am in a space with resolved markets
**When** I open history
**Then** I can see previous markets, outcomes, and my results
