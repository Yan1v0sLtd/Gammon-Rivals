import {useEffect, useState} from "react"

import {BoardPreview} from "../../../../../packages/board-preview/src/BoardPreview"
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
import {useConfirm} from "../../components/useConfirm"
import {boardToDraft, type BoardDraft} from "../../lib/boardToDraft"
import {builtInBoardSeeds} from "../../lib/builtInBoardSeeds.ts"
import {emptyToNull} from "../../lib/emptyToNull"
import {formatNumber} from "../../lib/formatNumber"
import {isPolicyError} from "../../lib/isPolicyError"
import {isValidBoardId} from "../../lib/isValidBoardId"
import {parseJson} from "../../lib/parseJson"
import {requiredNumber} from "../../lib/requiredNumber"
import {withGameplayBackgroundMetadata} from "../../lib/withGameplayBackgroundMetadata"

import {
  useAddLoadingScreenMutation,
  useActivateLoadingScreenMutation,
  useAddPodiumMutation,
  useActivatePodiumMutation,
  useDeleteBoardMutation,
  useDeleteLoadingScreenMutation,
  useDeletePodiumMutation,
  useGetBoardsQuery,
  useGetLoadingScreensQuery,
  useGetPodiumsQuery,
  useSeedBoardsMutation,
  useUpsertBoardMutation,
} from "./BoardThemesApi"
import type {
  BoardThemeConfigInsert,
  BoardThemeConfigRow,
  LoadingScreenImageInsert,
  LoadingScreenImageRow,
  PodiumImageInsert,
  PodiumImageRow,
} from "./BoardThemesData"

type Props = {
  readonly canManage: boolean,
  readonly updatedBy: string | null,
  readonly onError: (error: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Board Themes BO admin — the visual list of live/draft boards plus the
 * podium + loading-screen libraries and the board editor modal. Owns its
 * own data: the three library reads come from RTK Query, the drafts and
 * editor state live here, and every save/delete/activate goes through a
 * mutation. Failures are reported up through `onError` for page-level
 * display. No direct Supabase calls here.
 */
export function BoardThemesAdmin({
  canManage,
  updatedBy,
  onError,
  onBeforeSave,
}: Props) {
  const {
    data: boards = [],
    error: boardsError,
  } = useGetBoardsQuery()
  const {
    data: podiums = [],
    error: podiumsError,
  } = useGetPodiumsQuery()
  const {
    data: loadingScreens = [],
    error: loadingScreensError,
  } = useGetLoadingScreensQuery()
  const [upsertBoard, {isLoading: savingBoard}] = useUpsertBoardMutation()
  const [deleteBoard] = useDeleteBoardMutation()
  const [seedBoards, {isLoading: seedingBoards}] = useSeedBoardsMutation()
  const [addPodium] = useAddPodiumMutation()
  const [activatePodium] = useActivatePodiumMutation()
  const [deletePodium] = useDeletePodiumMutation()
  const [addLoadingScreen] = useAddLoadingScreenMutation()
  const [activateLoadingScreen] = useActivateLoadingScreenMutation()
  const [deleteLoadingScreen] = useDeleteLoadingScreenMutation()

  const {confirm, confirmUI} = useConfirm()

  const [boardDraft, setBoardDraft] = useState<BoardDraft>(() => boardToDraft())
  const [podiumDraft, setPodiumDraft] = useState<{name: string, image_url: string}>({
    name: "",
    image_url: "",
  })
  const [loadingScreenDraft, setLoadingScreenDraft] = useState<{name: string, image_url: string}>({
    name: "",
    image_url: "",
  })
  const [boardEditorOpen, setBoardEditorOpen] = useState(false)
  const [boardEditorMode, setBoardEditorMode] = useState<"add" | "edit">("add")
  const [boardMessage, setBoardMessage] = useState<string | null>(null)
  // Per-action busy key mirroring the old Admin `savingKey` so each
  // button disables individually while its own request is in flight.
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  // Surface fetch failures through the page-level error reporter.
  useEffect(() => {
    if (boardsError) onError(boardsError)
  }, [boardsError, onError])
  useEffect(() => {
    if (podiumsError) onError(podiumsError)
  }, [podiumsError, onError])
  useEffect(() => {
    if (loadingScreensError) onError(loadingScreensError)
  }, [loadingScreensError, onError])

  function openAddBoard() {
    setBoardMessage(null)
    setBoardDraft(boardToDraft())
    setBoardEditorMode("add")
    setBoardEditorOpen(true)
  }

  function openEditBoard(board: BoardThemeConfigRow) {
    setBoardMessage(null)
    setBoardDraft(boardToDraft(board))
    setBoardEditorMode("edit")
    setBoardEditorOpen(true)
  }

  async function saveBoard() {
    if (!canManage) return
    onBeforeSave()
    setBoardMessage(null)
    setPendingKey("board")
    try {
      const metadata = withGameplayBackgroundMetadata(parseJson(boardDraft.metadata, "Metadata", "object"), boardDraft.gameplay_background_image)
      const payload: BoardThemeConfigInsert = {
        id: boardDraft.id.trim(),
        display_name: boardDraft.display_name.trim(),
        preview_image: boardDraft.preview_image.trim(),
        gameplay_image: boardDraft.gameplay_image.trim(),
        lobby_background_image: emptyToNull(boardDraft.lobby_background_image),
        white_checker_image: emptyToNull(boardDraft.white_checker_image),
        black_checker_image: emptyToNull(boardDraft.black_checker_image),
        dice_image: emptyToNull(boardDraft.dice_image),
        tray_image: emptyToNull(boardDraft.tray_image),
        holder_image: emptyToNull(boardDraft.holder_image),
        unlock_level: requiredNumber(boardDraft.unlock_level, "Unlock level"),
        price_coins: requiredNumber(boardDraft.price_coins, "Price coins"),
        price_gems: requiredNumber(boardDraft.price_gems, "Gems cost"),
        is_enabled: boardDraft.is_enabled,
        is_featured: boardDraft.is_featured,
        sort_order: requiredNumber(boardDraft.sort_order, "Sort order"),
        metadata,
        updated_by: updatedBy,
      }
      await upsertBoard(payload).unwrap()
      setBoardDraft(boardToDraft())
      setBoardEditorOpen(false)
      setBoardMessage("Board theme saved.")
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function deleteBoardHandler(board: BoardThemeConfigRow) {
    if (!canManage) return
    const confirmed = await confirm({
      title: `Delete ${board.display_name}?`,
      message: "This removes it from the live board list.",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!confirmed) return
    onBeforeSave()
    setBoardMessage(null)
    setPendingKey(`board-delete-${board.id}`)
    try {
      await deleteBoard(board.id).unwrap()
      if (boardDraft.id === board.id) {
        setBoardDraft(boardToDraft())
        setBoardEditorOpen(false)
      }
      setBoardMessage("Board theme deleted.")
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function seedBuiltInBoards() {
    if (!canManage) return
    onBeforeSave()
    setBoardMessage("Adding the current game boards...")
    setPendingKey("board-seed")
    try {
      const payload = builtInBoardSeeds.map((board) => ({
        ...board,
        updated_by: updatedBy,
      }))
      await seedBoards(payload).unwrap()
      setBoardMessage(`Current boards populated: ${builtInBoardSeeds.length} boards are ready.`)
    }
    catch (err) {
      setBoardMessage(null)
      if (isPolicyError(err)) {
        onError("Supabase blocked the board write. Please run the latest board_theme_admin_write_policy migration in the Supabase SQL editor, then try again.")
      }
      else {
        onError(err)
      }
    }
    finally {
      setPendingKey(null)
    }
  }

  async function addPodiumHandler() {
    if (!canManage) return
    const image_url = podiumDraft.image_url.trim()
    if (!image_url) {
      onError("Upload or paste a podium image first.")
      return
    }
    onBeforeSave()
    setBoardMessage(null)
    setPendingKey("podium-add")
    try {
      const payload: PodiumImageInsert = {
        name: podiumDraft.name.trim() || "Podium",
        image_url,
        updated_by: updatedBy,
      }
      await addPodium(payload).unwrap()
      setPodiumDraft({
        name: "",
        image_url: "",
      })
      setBoardMessage("Podium added.")
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function activatePodiumHandler(podium: PodiumImageRow) {
    if (!canManage || podium.is_active) return
    onBeforeSave()
    setBoardMessage(null)
    setPendingKey(`podium-active-${podium.id}`)
    try {
      await activatePodium(podium.id).unwrap()
      setBoardMessage("Podium activated.")
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function deletePodiumHandler(podium: PodiumImageRow) {
    if (!canManage) return
    if (podium.is_active) {
      onError("Set another podium active before deleting the active one.")
      return
    }
    const confirmed = await confirm({
      title: `Delete podium "${podium.name}"?`,
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!confirmed) return
    onBeforeSave()
    setBoardMessage(null)
    setPendingKey(`podium-delete-${podium.id}`)
    try {
      await deletePodium(podium.id).unwrap()
      setBoardMessage("Podium deleted.")
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function addLoadingScreenHandler() {
    if (!canManage) return
    const image_url = loadingScreenDraft.image_url.trim()
    if (!image_url) {
      onError("Upload or paste a loading-screen image first.")
      return
    }
    onBeforeSave()
    setBoardMessage(null)
    setPendingKey("loading-screen-add")
    try {
      const payload: LoadingScreenImageInsert = {
        name: loadingScreenDraft.name.trim() || "Loading screen",
        image_url,
        updated_by: updatedBy,
      }
      await addLoadingScreen(payload).unwrap()
      setLoadingScreenDraft({
        name: "",
        image_url: "",
      })
      setBoardMessage("Loading screen added.")
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function activateLoadingScreenHandler(screen: LoadingScreenImageRow) {
    if (!canManage || screen.is_active) return
    onBeforeSave()
    setBoardMessage(null)
    setPendingKey(`loading-screen-active-${screen.id}`)
    try {
      await activateLoadingScreen(screen.id).unwrap()
      setBoardMessage("Loading screen activated.")
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function deleteLoadingScreenHandler(screen: LoadingScreenImageRow) {
    if (!canManage) return
    if (screen.is_active) {
      onError("Set another loading screen active before deleting the active one.")
      return
    }
    const confirmed = await confirm({
      title: `Delete loading screen "${screen.name}"?`,
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!confirmed) return
    onBeforeSave()
    setBoardMessage(null)
    setPendingKey(`loading-screen-delete-${screen.id}`)
    try {
      await deleteLoadingScreen(screen.id).unwrap()
      setBoardMessage("Loading screen deleted.")
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

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
          disabled={!canManage || seedingBoards}
          onClick={() => void seedBuiltInBoards()}>
          {seedingBoards ? "Populating..." : "Populate Current Boards"}
        </SecondaryButton>
        <PrimaryButton
          disabled={!canManage}
          onClick={openAddBoard}>
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
              disabled={!canManage || p.is_active || pendingKey === `podium-active-${p.id}`}
              type="button"
              onClick={() => {
                void activatePodiumHandler(p)
              }}>
              {p.is_active ? "Active" : pendingKey === `podium-active-${p.id}` ? "Activating..." : "Set active"}
            </button>
            <button
              className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManage || p.is_active || pendingKey === `podium-delete-${p.id}`}
              type="button"
              onClick={() => {
                void deletePodiumHandler(p)
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
                  setPodiumDraft((draft) => ({
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
                setPodiumDraft((draft) => ({
                  ...draft,
                  image_url: url,
                }))
              }}/>
          </div>
          <PrimaryButton
            disabled={!canManage || !podiumDraft.image_url.trim() || pendingKey === "podium-add"}
            onClick={() => void addPodiumHandler()}>
            {pendingKey === "podium-add" ? "Adding..." : "Add podium"}
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
              disabled={!canManage || s.is_active || pendingKey === `loading-screen-active-${s.id}`}
              type="button"
              onClick={() => {
                void activateLoadingScreenHandler(s)
              }}>
              {s.is_active ? "Active" : pendingKey === `loading-screen-active-${s.id}` ? "Activating..." : "Set active"}
            </button>
            <button
              className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManage || s.is_active || pendingKey === `loading-screen-delete-${s.id}`}
              type="button"
              onClick={() => {
                void deleteLoadingScreenHandler(s)
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
                  setLoadingScreenDraft((draft) => ({
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
                setLoadingScreenDraft((draft) => ({
                  ...draft,
                  image_url: url,
                }))
              }}/>
          </div>
          <PrimaryButton
            disabled={!canManage || !loadingScreenDraft.image_url.trim() || pendingKey === "loading-screen-add"}
            onClick={() => void addLoadingScreenHandler()}>
            {pendingKey === "loading-screen-add" ? "Adding..." : "Add loading screen"}
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
            openEditBoard(row)
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
                    openEditBoard(row)
                  }}>
                  Edit
                </button>
                <button
                  className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!canManage || pendingKey === `board-delete-${row.id}`}
                  type="button"
                  onClick={() => {
                    void deleteBoardHandler(row)
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
                setBoardEditorOpen(false)
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
                  setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
                  ...d,
                  display_name,
                }))
              }}/>
            <Field
              label="Unlock level"
              value={boardDraft.unlock_level}
              onChange={(unlock_level) => {
                setBoardDraft((d) => ({
                  ...d,
                  unlock_level,
                }))
              }}/>
            <Field
              label="Price coins"
              value={boardDraft.price_coins}
              onChange={(price_coins) => {
                setBoardDraft((d) => ({
                  ...d,
                  price_coins,
                }))
              }}/>
            <Field
              label="Gems cost"
              value={boardDraft.price_gems}
              onChange={(price_gems) => {
                setBoardDraft((d) => ({
                  ...d,
                  price_gems,
                }))
              }}/>
            <Field
              label="Sort order"
              value={boardDraft.sort_order}
              onChange={(sort_order) => {
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
                  ...d,
                  gameplay_image,
                }))
              }}/>
            <FeltCornersField
              gameplayImage={boardDraft.gameplay_image}
              metadata={boardDraft.metadata}
              onMetadataChange={(metadata) => {
                setBoardDraft((d) => ({
                  ...d,
                  metadata,
                }))
              }}/>
            <BearOffTraysField
              gameplayImage={boardDraft.gameplay_image}
              metadata={boardDraft.metadata}
              onMetadataChange={(metadata) => {
                setBoardDraft((d) => ({
                  ...d,
                  metadata,
                }))
              }}/>
            <BoardTuningField
              metadata={boardDraft.metadata}
              onMetadataChange={(metadata) => {
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
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
                setBoardDraft((d) => ({
                  ...d,
                  holder_image,
                }))
              }}/>
            <TextArea
              label="Metadata JSON object"
              value={boardDraft.metadata}
              onChange={(metadata) => {
                setBoardDraft((d) => ({
                  ...d,
                  metadata,
                }))
              }}/>
            <div className="grid grid-cols-2 gap-2">
              <Toggle
                checked={boardDraft.is_enabled}
                label="Enabled"
                onChange={(is_enabled) => {
                  setBoardDraft((d) => ({
                    ...d,
                    is_enabled,
                  }))
                }}/>
              <Toggle
                checked={boardDraft.is_featured}
                label="Featured"
                onChange={(is_featured) => {
                  setBoardDraft((d) => ({
                    ...d,
                    is_featured,
                  }))
                }}/>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => {
                setBoardEditorOpen(false)
              }}>Cancel</SecondaryButton>
              <PrimaryButton
                disabled={!canManage || savingBoard || (boardEditorMode === "add" && !isValidBoardId(boardDraft.id))}
                onClick={() => void saveBoard()}>
                {boardEditorMode === "add" ? "Add board" : "Save changes"}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>)}
    {confirmUI}
  </div>)
}
