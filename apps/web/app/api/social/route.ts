import { NextResponse } from "next/server";
import { AVATAR_CHOICES, normalizeFriendCode } from "@gambit/core";
import { requireIdentity, setName } from "@/lib/server/identity";
import { rateLimit } from "@/lib/server/rateLimit";
import {
  answerFriend,
  block,
  blocksOf,
  friendsOf,
  getProfile,
  inviteFriend,
  invitesFor,
  profileByFriendCode,
  profileOf,
  recentFor,
  removeFriend,
  requestFriend,
  requestsFor,
  requestsFrom,
  unblock,
  updateProfile
} from "@/lib/server/social";
import { store } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the lobby's people panel needs, in one round trip. */
export async function GET() {
  const me = await requireIdentity();
  const profile = getProfile(me.playerId, me.name);
  return NextResponse.json({
    me: profile,
    avatars: AVATAR_CHOICES,
    friends: friendsOf(me.playerId),
    requests: requestsFor(me.playerId),
    sent: requestsFrom(me.playerId),
    blocked: blocksOf(me.playerId),
    recent: recentFor(me.playerId),
    invites: invitesFor(me.playerId)
  });
}

type Body =
  | { action: "profile"; name?: string; avatar?: string }
  | { action: "add"; friendCode: string }
  | { action: "add-id"; playerId: string }
  | { action: "answer"; playerId: string; accept: boolean }
  | { action: "remove"; playerId: string }
  | { action: "block"; playerId: string }
  | { action: "unblock"; playerId: string }
  | { action: "invite"; playerId: string; roomId: string };

export async function POST(req: Request) {
  const me = await requireIdentity();
  if (!rateLimit(`social:${me.playerId}`, 40, 60_000)) {
    return NextResponse.json(
      { error: { code: "rate", message: "Steady on — try that again in a moment." } },
      { status: 429 }
    );
  }
  const body = (await req.json()) as Body;
  getProfile(me.playerId, me.name);

  switch (body.action) {
    case "profile": {
      const profile = updateProfile(me.playerId, { name: body.name, avatar: body.avatar });
      // The cookie carries the name into rooms, so keep the two in step.
      if (body.name) await setName(profile.name);
      return NextResponse.json({ me: profile });
    }

    case "add": {
      const target = profileByFriendCode(normalizeFriendCode(body.friendCode));
      if (!target) {
        return NextResponse.json(
          { error: { code: "no-such-code", message: "No player with that code." } },
          { status: 404 }
        );
      }
      const res = requestFriend(me.playerId, target.playerId);
      if (!res.ok) {
        return NextResponse.json({ error: { code: "cannot-add", message: res.message } }, { status: 400 });
      }
      return NextResponse.json({ ok: true, added: target.name });
    }

    case "add-id": {
      if (!profileOf(body.playerId)) {
        return NextResponse.json(
          { error: { code: "no-such-player", message: "We don't know that player." } },
          { status: 404 }
        );
      }
      const res = requestFriend(me.playerId, body.playerId);
      if (!res.ok) {
        return NextResponse.json({ error: { code: "cannot-add", message: res.message } }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    case "answer": {
      const handled = answerFriend(me.playerId, body.playerId, body.accept);
      if (!handled) {
        return NextResponse.json(
          { error: { code: "no-request", message: "There's no request from them." } },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "remove":
      removeFriend(me.playerId, body.playerId);
      return NextResponse.json({ ok: true });

    case "block":
      block(me.playerId, body.playerId);
      return NextResponse.json({ ok: true });

    case "unblock":
      unblock(me.playerId, body.playerId);
      return NextResponse.json({ ok: true });

    case "invite": {
      const room = await store.getRoom(body.roomId);
      if (!room) {
        return NextResponse.json(
          { error: { code: "no-room", message: "That table no longer exists." } },
          { status: 404 }
        );
      }
      if (!room.players.some((p) => p.playerId === me.playerId)) {
        return NextResponse.json(
          { error: { code: "not-here", message: "Invite people to a table you're sitting at." } },
          { status: 403 }
        );
      }
      inviteFriend({
        from: me.playerId,
        to: body.playerId,
        roomId: room.id,
        code: room.code,
        gameId: room.gameId,
        at: Date.now()
      });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json(
        { error: { code: "unknown-action", message: "That control doesn't exist." } },
        { status: 400 }
      );
  }
}
