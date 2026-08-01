# Split the Back Office into a Separate App

## Goal

Separate the Back Office logic and UI from the player game into an independent application while keeping both applications in the same repository and connected to the existing Supabase backend.

The split must create clear actor boundaries:

- The game app handles players, guests, matches, progression, rewards, and purchases.
- The admin app handles operators, configuration, users, economy controls, content, reports, and simulations.
- Player and admin authentication remain independent.
- Backend authorization continues to be enforced by admin roles, the email allowlist, guarded RPCs, and RLS policies.
- Shared code is owned outside either application and is not duplicated.

## Phase 1: Establish the application boundary

### Intermediate steps

1. Define separate `game` and `admin` application entry points.
2. Keep both applications in the existing repository.
3. Give the admin app its own router and root component.
4. Move `/admin` into the admin app root route.
5. Move `/admin/auth/callback` into the admin app as `/auth/callback`.
6. Keep the game routes and native application entry in the game app.
7. Keep both applications connected to the existing Supabase project.

## Phase 2: Separate authentication

### Intermediate steps

1. Move `AdminAuthProvider`, `useAdminAuth`, and `adminSupabase` into the admin app.
2. Initialize `AdminAuthProvider` only in the admin app.
3. Keep Google OAuth as the admin sign-in method.
4. Keep the admin Supabase session storage separate from player session storage.
5. Configure the admin app OAuth callback URL.
6. Preserve role resolution through `admin_roles` and `admin_email_allowlist`.
7. Preserve authorization through `get_my_admin_role`, guarded admin RPCs, and RLS.
8. Remove admin authentication initialization from the game app.
9. Keep guest and Google player authentication inside the game app.

## Phase 3: Move the Back Office UI

### Intermediate steps

1. Move `src/pages/Admin.tsx` into the admin app.
2. Move `src/pages/AdminAuthCallback.tsx` into the admin app.
3. Move all components under `src/admin/` into the admin app.
4. Move admin-only styles and assets into the admin app.
5. Preserve the current Back Office sections and behavior.
6. Preserve user management, economy controls, mission tools, wheel configuration, board configuration, shop configuration, reports, and audit views.
7. Verify that admin routes no longer depend on the game router or player providers.

## Phase 4: Extract shared dependencies

### Intermediate steps

1. Move generated database types into shared code used by both applications.
2. Extract currency formatting used by both applications.
3. Extract progression calculations used by both applications.
4. Extract the board preview and its required renderer, theme, coordinate, and engine types into shared code.
5. Update the game and admin apps to import shared dependencies from the same source.
6. Remove duplicated shared code.
7. Keep game-only session and UI code out of the admin app.
8. Keep admin-only code out of the game app.

## Phase 5: Remove admin behavior from the game

### Intermediate steps

1. Remove admin routes from the game router.
2. Remove `AdminAuthProvider` from the game application root.
3. Remove the admin Supabase client from the game build.
4. Remove admin pages and components from the game source tree.
5. Remove the player-shop admin-role check.
6. Move test purchases, economy grants, and operator tools into the admin app.
7. Verify that the game app only exposes player-facing behavior.

## Phase 6: Isolate admin data access

### Intermediate steps

1. Introduce an admin data-access boundary between the admin UI and Supabase.
2. Group admin operations by domain: users, economy, missions, wheel, shop, boards, content, reports, and authentication.
3. Move direct table queries out of admin UI components.
4. Move direct RPC calls out of admin UI components.
5. Move storage uploads behind the admin data-access boundary.
6. Keep the initial data-access implementation backed by Supabase.
7. Keep admin authorization enforced on the backend rather than in UI checks alone.

## Phase 7: Deploy and validate the separated apps

### Intermediate steps

1. Build the game and admin apps independently.
2. Deploy the admin app on its own origin.
3. Configure routing for direct admin URLs and OAuth callbacks.
4. Configure the Supabase OAuth redirect allowlist for the admin origin.
5. Verify that player and admin sessions can coexist in the same browser.
6. Verify that player accounts cannot access admin operations.
7. Verify that admin roles retain their current read and write permissions.
8. Verify board-asset uploads and public URLs.
9. Verify Back Office configuration changes are reflected in the game.
10. Verify that the game build contains no admin routes, providers, or UI modules.
