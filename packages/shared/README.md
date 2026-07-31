# Shared client code

Code in this package is owned by both the player and Back Office apps.

Allowed here:

- Generated database types
- Pure currency and progression helpers
- Shared client bootstrap/error helpers

Do not import player auth, game sessions, lobby UI, or admin Supabase clients into this package.
