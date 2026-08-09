import {BoardPreview} from "../../../../../packages/board-preview/src/BoardPreview"
import type {Database} from "../../../../../packages/shared/src/database"
import {BearOffTraysField} from "../../components/BearOffTraysField"
import {BoardTuningField} from "../../components/BoardTuningField"
import {EmptyState} from "../../components/EmptyState"
import {FeltCornersField} from "../../components/FeltCornersField"
import {Field} from "../../components/Field"
import {ImageField} from "../../components/ImageField"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {StatusPill} from "../../components/StatusPill"
import {TextArea} from "../../components/TextArea"
import {Toggle} from "../../components/Toggle"
import type {BoardDraft} from "../../lib/boardToDraft"
import {formatNumber} from "../../lib/formatNumber"
import {isValidBoardId} from "../../lib/isValidBoardId"

type BoardThemeConfig = Database["public"]["Tables"]["board_theme_configs"]["Row"]
type PodiumImage = Database["public"]["Tables"]["podium_images"]["Row"]
type LoadingScreenImage = Database["public"]["Tables"]["loading_screen_images"]["Row"]

type Props = {
  readonly boards: readonly BoardThemeConfig[],
  readonly podiums: readonly PodiumImage[],
  readonly loadingScreens: readonly LoadingScreenImage[],
  readonly boardDraft: BoardDraft,
  readonly podiumDraft: {name: string, image_url: string},
  readonly loadingScreenDraft: {name: string, image_url: string},
  readonly boardMessage: string | null,
  readonly boardEditorOpen: boolean,
  readonly boardEditorMode: "add" | "edit",
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly onSeedBuiltInBoards: () => void,
  readonly onOpenAddBoard: () => void,
  readonly onOpenEditBoard: (board: BoardThemeConfig) => void,
  readonly onDeleteBoard: (board: BoardThemeConfig) => void,
  readonly onSaveBoard: () => void,
  readonly onActivatePodium: (podium: PodiumImage) => void,
  readonly onDeletePodium: (podium: PodiumImage) => void,
  readonly onAddPodium: () => void,
  readonly onActivateLoadingScreen: (screen: LoadingScreenImage) => void,
  readonly onDeleteLoadingScreen: (screen: LoadingScreenImage) => void,
  readonly onAddLoadingScreen: () => void,
  readonly onSetBoardDraft: (updater: (draft: BoardDraft) => BoardDraft) => void,
  readonly onSetPodiumDraft: (updater: (draft: {name: string, image_url: string}) => {name: string, image_url: string}) => void,
  readonly onSetLoadingScreenDraft: (updater: (draft: {name: string, image_url: string}) => {name: string, image_url: string}) => void,
  readonly onSetBoardEditorOpen: (open: boolean) => void,
}

/**
 * Board Themes BO admin — the visual list of live/draft boards plus the
 * podium + loading-screen libraries and the board editor modal.
 * Purely presentational: it renders from data the parent (Admin) already
 * owns and reports edits/actions back through explicit callbacks. No data
 * fetching here.
 */
export function BoardThemesAdmin({
  boards,
  podiums,
  loadingScreens,
  boardDraft,
  podiumDraft,
  loadingScreenDraft,
  boardMessage,
  boardEditorOpen,
  boardEditorMode,
  canManage,
  savingKey,
  onSeedBuiltInBoards,
  onOpenAddBoard,
  onOpenEditBoard,
  onDeleteBoard,
  onSaveBoard,
  onActivatePodium,
  onDeletePodium,
  onAddPodium,
  onActivateLoadingScreen,
  onDeleteLoadingScreen,
  onAddLoadingScreen,
  onSetBoardDraft,
  onSetPodiumDraft,
  onSetLoadingScreenDraft,
  onSetBoardEditorOpen,
}: Props) {
  return (<div className="space-y-4">
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <div>
        <h2 className="text-lg font-black">Board Themes</h2>
        <p className="mt-1 text-sm text-white/50">
          Visual list of live and draft boards used by the lobby and gameplay.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <SecondaryButton
          disabled={!canManage || savingKey === "board-seed"}
          onClick={onSeedBuiltInBoards}>
          {savingKey === "board-seed" ? "Populating..." : "Populate Current Boards"}
        </SecondaryButton>
        <PrimaryButton
          disabled={!canManage}
          onClick={onOpenAddBoard}>
          Add Board
        </PrimaryButton>
      </div>
    </div>

    {boardMessage && (<div
      className="rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-100">
      {boardMessage}
    </div>)}

    {/* Podium — the stand the board sits on in the lobby
            carousel. A small library; exactly one is active. */}
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <div>
        <h3 className="text-base font-black">Podium</h3>
        <p className="mt-1 text-sm text-white/50">
          The stand the board sits on in the lobby carousel. Upload options and pick
          the one that&apos;s live. Wide transparent PNG/WebP works best.
        </p>
      </div>

      {podiums.length > 0 && (<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {podiums.map((p) => (<div
          key={p.id}
          className={`overflow-hidden rounded-lg border p-3 transition ${p.is_active ? "border-amber-300/60 bg-amber-300/[0.06]" : "border-white/10 bg-black/20"}`}>
          <div className="grid aspect-[16/9] place-items-center overflow-hidden rounded bg-black/40">
            <img
              alt={p.name}
              className="h-full w-full object-contain"
              loading="lazy"
              src={p.image_url}/>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold">{p.name}</span>
            {p.is_active && (<span
              className="shrink-0 rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-100">
              Active
            </span>)}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="flex-1 rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManage || p.is_active || savingKey === `podium-active-${p.id}`}
              type="button"
              onClick={() => {
                onActivatePodium(p)
              }}>
              {p.is_active ? "Active" : savingKey === `podium-active-${p.id}` ? "Activating..." : "Set active"}
            </button>
            <button
              className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManage || p.is_active || savingKey === `podium-delete-${p.id}`}
              type="button"
              onClick={() => {
                onDeletePodium(p)
              }}>
              Delete
            </button>
          </div>
        </div>))}
      </div>)}

      <div className="mt-4 rounded-lg border border-dashed border-white/15 bg-black/20 p-3">
        <div className="text-xs font-bold uppercase tracking-[0.14em] text-white/40">
          Add a podium
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60 disabled:opacity-50"
                disabled={!canManage}
                placeholder="e.g. Royal Holder"
                type="text"
                value={podiumDraft.name}
                onChange={(event) => {
                  onSetPodiumDraft((draft) => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }}/>
            </label>
            <ImageField
              disabled={!canManage}
              folder="podiums"
              label="Podium image"
              value={podiumDraft.image_url}
              onChange={(url) => {
                onSetPodiumDraft((draft) => ({
                  ...draft,
                  image_url: url,
                }))
              }}/>
          </div>
          <PrimaryButton
            disabled={!canManage || !podiumDraft.image_url.trim() || savingKey === "podium-add"}
            onClick={onAddPodium}>
            {savingKey === "podium-add" ? "Adding..." : "Add podium"}
          </PrimaryButton>
        </div>
      </div>
    </div>

    {/* Loading screen — the full-art cover shown while routes /
            assets load. Same library model as the podium: many rows,
            exactly one active (the client caches the active URL). */}
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <div>
        <h3 className="text-base font-black">Loading screen</h3>
        <p className="mt-1 text-sm text-white/50">
          The full-screen art players see while the game loads. Upload themed
          variants (holidays, promos) and pick the live one. Landscape ~2:1 WebP
          works best — the gold progress bar is drawn on top near the bottom.
        </p>
      </div>

      {loadingScreens.length > 0 && (<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loadingScreens.map((s) => (<div
          key={s.id}
          className={`overflow-hidden rounded-lg border p-3 transition ${s.is_active ? "border-amber-300/60 bg-amber-300/[0.06]" : "border-white/10 bg-black/20"}`}>
          <div className="grid aspect-video place-items-center overflow-hidden rounded bg-black/40">
            <img
              alt={s.name}
              className="h-full w-full object-cover"
              loading="lazy"
              src={s.image_url}/>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold">{s.name}</span>
            {s.is_active && (<span
              className="shrink-0 rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-100">
              Active
            </span>)}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="flex-1 rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManage || s.is_active || savingKey === `loading-screen-active-${s.id}`}
              type="button"
              onClick={() => {
                onActivateLoadingScreen(s)
              }}>
              {s.is_active ? "Active" : savingKey === `loading-screen-active-${s.id}` ? "Activating..." : "Set active"}
            </button>
            <button
              className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManage || s.is_active || savingKey === `loading-screen-delete-${s.id}`}
              type="button"
              onClick={() => {
                onDeleteLoadingScreen(s)
              }}>
              Delete
            </button>
          </div>
        </div>))}
      </div>)}

      <div className="mt-4 rounded-lg border border-dashed border-white/15 bg-black/20 p-3">
        <div className="text-xs font-bold uppercase tracking-[0.14em] text-white/40">
          Add a loading screen
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60 disabled:opacity-50"
                disabled={!canManage}
                placeholder="e.g. Winter 2026"
                type="text"
                value={loadingScreenDraft.name}
                onChange={(event) => {
                  onSetLoadingScreenDraft((draft) => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }}/>
            </label>
            <ImageField
              disabled={!canManage}
              folder="loading-screens"
              label="Loading screen image"
              value={loadingScreenDraft.image_url}
              onChange={(url) => {
                onSetLoadingScreenDraft((draft) => ({
                  ...draft,
                  image_url: url,
                }))
              }}/>
          </div>
          <PrimaryButton
            disabled={!canManage || !loadingScreenDraft.image_url.trim() || savingKey === "loading-screen-add"}
            onClick={onAddLoadingScreen}>
            {savingKey === "loading-screen-add" ? "Adding..." : "Add loading screen"}
          </PrimaryButton>
        </div>
      </div>
    </div>

    {boards.length === 0 ? (
      <EmptyState text="No board themes yet. Use Populate Current Boards or Add Board to create one."/>) : (
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {boards.map((row) => (<div
          key={row.id}
          className="group cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] shadow-xl shadow-black/15 transition hover:-translate-y-0.5 hover:border-amber-200/45"
          onClick={() => {
            onOpenEditBoard(row)
          }}>
          <div className="relative aspect-[16/10] overflow-hidden bg-black/25">
            {row.lobby_background_image ? (<img
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-40 blur-sm transition group-hover:scale-105"
              loading="lazy"
              src={row.lobby_background_image}/>) : null}
            <img
              alt={`${row.display_name} lobby preview`}
              className="relative z-10 h-full w-full object-contain p-4 drop-shadow-[0_18px_16px_rgba(0,0,0,0.45)]"
              loading="lazy"
              src={row.preview_image}/>
            <div className="absolute left-3 top-3 z-20">
              <StatusPill enabled={row.is_enabled}/>
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-black">{row.display_name}</h3>
                <p className="mt-1 truncate font-mono text-xs text-white/40">{row.id}</p>
              </div>
              <div
                className="flex shrink-0 gap-2"
                onClick={(event) => {
                  event.stopPropagation()
                }}>
                <button
                  className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/75 transition hover:bg-white/15"
                  type="button"
                  onClick={() => {
                    onOpenEditBoard(row)
                  }}>
                  Edit
                </button>
                <button
                  className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!canManage || savingKey === `board-delete-${row.id}`}
                  type="button"
                  onClick={() => {
                    onDeleteBoard(row)
                  }}>
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-white/55">
              <div className="rounded-lg bg-black/18 p-2">
                <div className="text-white/35">Level</div>
                <div className="font-bold text-white">{row.unlock_level}</div>
              </div>
              <div className="rounded-lg bg-black/18 p-2">
                <div className="text-white/35">Coins</div>
                <div className="font-bold text-white">{formatNumber(row.price_coins)}</div>
              </div>
              <div className="rounded-lg bg-black/18 p-2">
                <div className="text-white/35">Gems</div>
                <div className="font-bold text-white">{formatNumber(row.price_gems ?? 0)}</div>
              </div>
              <div className="rounded-lg bg-black/18 p-2">
                <div className="text-white/35">Sort</div>
                <div className="font-bold text-white">{row.sort_order}</div>
              </div>
            </div>
          </div>
        </div>))}
      </div>)}

    {boardEditorOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div
          className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/12 bg-[#0b1930] p-5 shadow-2xl shadow-black/50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200/65">
                {boardEditorMode === "add" ? "Add Board" : "Edit Board"}
              </div>
              <h2 className="mt-1 text-2xl font-black">
                {boardEditorMode === "add" ? "New board theme" : boardDraft.display_name || "Board theme"}
              </h2>
            </div>
            <button
              className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white/70 transition hover:bg-white/15"
              type="button"
              onClick={() => {
                onSetBoardEditorOpen(false)
              }}>
              Close
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div>
              <Field
                disabled={boardEditorMode === "edit"}
                label="Board id"
                value={boardDraft.id}
                onChange={(id) => {
                  onSetBoardDraft((d) => ({
                    ...d,
                    id,
                  }))
                }}/>
              {boardEditorMode === "add" && boardDraft.id !== "" && !isValidBoardId(boardDraft.id) && (
                <div className="mt-1 text-[10px] font-bold normal-case tracking-normal text-rose-300">
                  Must be lowercase letters/digits, separated by - or _.
                  Start with a letter or digit. Examples: caribbean-full, zen-garden, classic_purple.
                </div>)}
            </div>
            <Field
              label="Display name"
              value={boardDraft.display_name}
              onChange={(display_name) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  display_name,
                }))
              }}/>
            <Field
              label="Unlock level"
              value={boardDraft.unlock_level}
              onChange={(unlock_level) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  unlock_level,
                }))
              }}/>
            <Field
              label="Price coins"
              value={boardDraft.price_coins}
              onChange={(price_coins) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  price_coins,
                }))
              }}/>
            <Field
              label="Gems cost"
              value={boardDraft.price_gems}
              onChange={(price_gems) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  price_gems,
                }))
              }}/>
            <Field
              label="Sort order"
              value={boardDraft.sort_order}
              onChange={(sort_order) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  sort_order,
                }))
              }}/>
          </div>
          <div className="mt-3 space-y-3">
            <ImageField
              folder={boardDraft.id}
              kind="preview"
              label="Lobby image"
              value={boardDraft.preview_image}
              onChange={(preview_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  preview_image,
                }))
              }}/>
            <ImageField
              folder={boardDraft.id}
              kind="gameplay"
              label="Gameplay image"
              value={boardDraft.gameplay_image}
              onChange={(gameplay_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  gameplay_image,
                }))
              }}/>
            <FeltCornersField
              gameplayImage={boardDraft.gameplay_image}
              metadata={boardDraft.metadata}
              onMetadataChange={(metadata) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  metadata,
                }))
              }}/>
            <BearOffTraysField
              gameplayImage={boardDraft.gameplay_image}
              metadata={boardDraft.metadata}
              onMetadataChange={(metadata) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  metadata,
                }))
              }}/>
            <BoardTuningField
              metadata={boardDraft.metadata}
              onMetadataChange={(metadata) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  metadata,
                }))
              }}/>
            <BoardPreview
              blackChecker={boardDraft.black_checker_image}
              gameplayImage={boardDraft.gameplay_image}
              metadata={boardDraft.metadata}
              whiteChecker={boardDraft.white_checker_image}/>
            <ImageField
              folder={boardDraft.id}
              kind="lobby-bg"
              label="Lobby background image"
              value={boardDraft.lobby_background_image}
              onChange={(lobby_background_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  lobby_background_image,
                }))
              }}/>
            <ImageField
              folder={boardDraft.id}
              kind="gameplay-bg"
              label="Gameplay background image"
              value={boardDraft.gameplay_background_image}
              onChange={(gameplay_background_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  gameplay_background_image,
                }))
              }}/>
            <ImageField
              folder={boardDraft.id}
              kind="checker-white"
              label="White checker image"
              value={boardDraft.white_checker_image}
              onChange={(white_checker_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  white_checker_image,
                }))
              }}/>
            <ImageField
              folder={boardDraft.id}
              kind="checker-black"
              label="Black checker image"
              value={boardDraft.black_checker_image}
              onChange={(black_checker_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  black_checker_image,
                }))
              }}/>
            <ImageField
              folder={boardDraft.id}
              kind="dice"
              label="Dice sprite (3 cols × 2 rows: face 1 top-left → face 6 bottom-right)"
              value={boardDraft.dice_image}
              onChange={(dice_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  dice_image,
                }))
              }}/>
            <ImageField
              folder={boardDraft.id}
              kind="tray"
              label="Tray image"
              value={boardDraft.tray_image}
              onChange={(tray_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  tray_image,
                }))
              }}/>
            <ImageField
              folder={boardDraft.id}
              kind="holder"
              label="Holder image"
              value={boardDraft.holder_image}
              onChange={(holder_image) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  holder_image,
                }))
              }}/>
            <TextArea
              label="Metadata JSON object"
              value={boardDraft.metadata}
              onChange={(metadata) => {
                onSetBoardDraft((d) => ({
                  ...d,
                  metadata,
                }))
              }}/>
            <div className="grid grid-cols-2 gap-2">
              <Toggle
                checked={boardDraft.is_enabled}
                label="Enabled"
                onChange={(is_enabled) => {
                  onSetBoardDraft((d) => ({
                    ...d,
                    is_enabled,
                  }))
                }}/>
              <Toggle
                checked={boardDraft.is_featured}
                label="Featured"
                onChange={(is_featured) => {
                  onSetBoardDraft((d) => ({
                    ...d,
                    is_featured,
                  }))
                }}/>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => {
                onSetBoardEditorOpen(false)
              }}>Cancel</SecondaryButton>
              <PrimaryButton
                disabled={!canManage || savingKey === "board" || (boardEditorMode === "add" && !isValidBoardId(boardDraft.id))}
                onClick={onSaveBoard}>
                {boardEditorMode === "add" ? "Add board" : "Save changes"}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>)}
  </div>)
}
