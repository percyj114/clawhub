# Official Publishers

`official` is a ClawHub admin-set publisher policy flag.

For now, Official means the publisher is OpenClaw/Foundation-affiliated. It is
reserved for OpenClaw-owned accounts and named people working with the OpenClaw
Foundation. The initial official handles are:

- `openclaw`
- `steipete`

Official must not be accepted from uploaded skill or package metadata.
Org membership does not make a personal publisher Official. In the current
OpenClaw case, `openclaw` and `steipete` are Official publisher handles;
Patrick's personal publisher remains community unless an admin explicitly marks
that publisher Official too.

The same policy signal appears in two places:

- Publisher/profile UI: official publishers show an `Official` badge.
- Owned package/skill UI: packages and skills owned by Official publishers show
  `Official` to users when they are public. Public packages use the `official`
  channel; private packages stay private.

`trustedPublisher` is an internal automated-publish permission. It does not make
a publisher or package Official.

Installed skill origin metadata may include:

```json
{
  "official": true,
  "ownerHandle": "openclaw"
}
```

`official: true` in installed metadata means the installed skill/package was
owned by an Official publisher or was otherwise explicitly marked Official by
ClawHub at install time.
