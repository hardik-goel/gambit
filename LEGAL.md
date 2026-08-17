# Legal position

Gambit ships eleven games. Several are **mechanically inspired** by well-known
commercial board games. This document states the line we hold and how we hold it.

## The principle

Game **mechanics, systems and rules are not protectable** by copyright. What *is*
protected — and what we never touch — is **names, trademarks, boards, maps, card
and tile art, characters, box design and overall trade dress**.

So: a game where you spend coloured cards to claim rail routes between cities is
a mechanic. *That* game's name, its map of Europe, its exact route layout, its
card illustrations and its logo are someone else's property. We implement the
first and originate the second, entirely.

## Per-game position

| Players may recognise | Ships as | Original in Gambit | Never used |
|---|---|---|---|
| Ticket to Ride | **Boxcar** | name; all three maps (city sets, coordinates, route graphs, ticket sets); card and board art | the original name, its published maps, its art |
| Catan | **Landfall** | name; island art; card and board design; all naming of resources | the original name, board art, card art |
| Sequence | **Quintet** | name; board art and layout treatment | the original name and board design |
| Scotland Yard | **Phantom** | name; the entire 120-node city graph; character treatment | the original name, its London map, its characters |
| Cluedo / Clue | **Motive** | name; six suspects, six implements, nine rooms — all newly written; mansion layout | the original name, characters, rooms, weapons |
| Carcassonne | **Hamlet** | name; tile art and the tile distribution we author | the original name, tile art |
| Azul | **Mosaic** | name; tile designs and wall pattern art | the original name, tile art |
| Splendor | **Facet** | name; card art, gem treatment, noble art | the original name, card art |
| Risk | **Stronghold** | name; a wholly original 42-territory world map and region set | the original name, its map |
| Pandemic | **Remedy** | name; 48-city network, four afflictions, five roles — all newly written | the original name, roles, city network, art |
| Chess | **Chess** | nothing needs to be — the game is public domain | — |

## Rules we work to

1. **Never** use a left-column name in product copy, code identifiers, marketing,
   store listings, support articles, or commit messages.
2. Every map, board, tile, card, token and icon is authored for Gambit or comes
   from a CC0/public-domain source recorded in `CREDITS.md`.
3. Rule text in the app is written in our own words. We do not reproduce
   published rulebooks.
4. Comparative statements appear in two places: on each game's cover, as "our
   take on <title>", and on `/compare`, which names
   the well-known games ours resemble so that a newcomer can find their way in.
   This is **nominative use** — naming a product to describe a real similarity
   to it — and it is defensible only while the page makes all three of these
   plain, which it does:

   - the games here are ours: our rules text, our maps, our art;
   - the names belong to their publishers, and are attributed to them;
   - there is no affiliation, endorsement or sponsorship, and the page says so.

   The shelf's footer carries the same attribution, so the claim and the
   disclaimer are never separated.

   Nowhere else. Not on a felt, not in a tutorial, not in a game's own name,
   not in an identifier, not in rules text. `registry.test.ts` enforces this:
   another publisher's title may appear only in a game's `familiar` field, and
   only with the publisher recorded beside it. A title used to *describe* a
   game is nominative use; the same title inside the game's own name or rules
   would be a claim about its origin.
5. Public-domain games (Chess, and any others added later) are labelled as such.

## Audio and music

All sound effects are synthesised at runtime from oscillators and filtered noise
(`packages/ui/src/audio.ts`) — original by construction, with no sample library
in the dependency chain. Music loops are generated the same way. Players may add
their own local audio files; those are read as object URLs on the device and are
**never uploaded**, so no licensed recording ever touches our servers.

## Data protection (DPDP)

We collect a display name, an emoji and a random player id. Accounts, when
enabled, will add an email address; today there are none, and clearing your
cookies is already the end of you as far as Gambit is concerned.

**Export**: `GET /api/me/data` returns everything held about the caller as a
file — profile, friends, blocks, invites, ratings and open tables. It is offered
from the people panel as "Download everything we hold".

**Deletion**: `DELETE /api/me/data` erases the profile, the friendships, the
blocks, the invites and the ratings, removes the player from any open table and
clears their identity. The next visit is a stranger with a new id and a new
friend code.

One thing is deliberately *not* deleted, and the endpoint says so in its own
response: a finished game is also the other players' record of their evening.
Those are kept, with the departing player's seat unlinked from them and renamed
"Former player" — so nothing points back, and nobody else loses their replay.
Event logs are retained for replay and anti-cheat under the same rule.
