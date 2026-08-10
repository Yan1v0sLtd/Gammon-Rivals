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

import styles from "./BoardThemesAdmin.module.css"
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

  return (<div className={styles.layout}>
    <div className={styles.headerPanel}>
      <div>
        <h2 className={styles.headerTitle}>Board Themes</h2>
        <p className={styles.headerDesc}>
          Visual list of live and draft boards used by the lobby and gameplay.
        </p>
      </div>
      <div className={styles.headerActions}>
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

    {boardMessage && (<div className={styles.boardMessage}>
      {boardMessage}
    </div>)}

    {/* Podium — the stand the board sits on in the lobby
            carousel. A small library; exactly one is active. */}
    <div className={styles.panel}>
      <div>
        <h3 className={styles.sectionTitle}>Podium</h3>
        <p className={styles.sectionDesc}>
          The stand the board sits on in the lobby carousel. Upload options and pick
          the one that&apos;s live. Wide transparent PNG/WebP works best.
        </p>
      </div>

      {podiums.length > 0 && (<div className={styles.libraryGrid}>
        {podiums.map((p) => (<div
          key={p.id}
          className={`${styles.libraryCard} ${p.is_active ? styles.libraryCardActive : ""}`}>
          <div className={styles.libraryImgWrap}>
            <img
              alt={p.name}
              className={styles.libraryImgContain}
              loading="lazy"
              src={p.image_url}/>
          </div>
          <div className={styles.libraryNameRow}>
            <span className={styles.libraryName}>{p.name}</span>
            {p.is_active && (<span className={styles.activeBadge}>
              Active
            </span>)}
          </div>
          <div className={styles.libraryActions}>
            <button
              className={styles.activateButton}
              disabled={!canManage || p.is_active || pendingKey === `podium-active-${p.id}`}
              type="button"
              onClick={() => {
                void activatePodiumHandler(p)
              }}>
              {p.is_active ? "Active" : pendingKey === `podium-active-${p.id}` ? "Activating..." : "Set active"}
            </button>
            <button
              className={styles.deleteButton}
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

      <div className={styles.addBox}>
        <div className={styles.addBoxTitle}>
          Add a podium
        </div>
        <div className={styles.addBoxGrid}>
          <div className={styles.addBoxFields}>
            <label className={styles.addLabel}>
              Name
              <input
                className={styles.addInput}
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
    <div className={styles.panel}>
      <div>
        <h3 className={styles.sectionTitle}>Loading screen</h3>
        <p className={styles.sectionDesc}>
          The full-screen art players see while the game loads. Upload themed
          variants (holidays, promos) and pick the live one. Landscape ~2:1 WebP
          works best — the gold progress bar is drawn on top near the bottom.
        </p>
      </div>

      {loadingScreens.length > 0 && (<div className={styles.libraryGrid}>
        {loadingScreens.map((s) => (<div
          key={s.id}
          className={`${styles.libraryCard} ${s.is_active ? styles.libraryCardActive : ""}`}>
          <div className={styles.libraryImgWrap}>
            <img
              alt={s.name}
              className={styles.libraryImgCover}
              loading="lazy"
              src={s.image_url}/>
          </div>
          <div className={styles.libraryNameRow}>
            <span className={styles.libraryName}>{s.name}</span>
            {s.is_active && (<span className={styles.activeBadge}>
              Active
            </span>)}
          </div>
          <div className={styles.libraryActions}>
            <button
              className={styles.activateButton}
              disabled={!canManage || s.is_active || pendingKey === `loading-screen-active-${s.id}`}
              type="button"
              onClick={() => {
                void activateLoadingScreenHandler(s)
              }}>
              {s.is_active ? "Active" : pendingKey === `loading-screen-active-${s.id}` ? "Activating..." : "Set active"}
            </button>
            <button
              className={styles.deleteButton}
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

      <div className={styles.addBox}>
        <div className={styles.addBoxTitle}>
          Add a loading screen
        </div>
        <div className={styles.addBoxGrid}>
          <div className={styles.addBoxFields}>
            <label className={styles.addLabel}>
              Name
              <input
                className={styles.addInput}
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
      <div className={styles.boardsGrid}>
        {boards.map((row) => (<div
          key={row.id}
          className={styles.boardCard}
          onClick={() => {
            openEditBoard(row)
          }}>
          <div className={styles.boardImgWrap}>
            {row.lobby_background_image ? (<img
              alt=""
              className={styles.boardBg}
              loading="lazy"
              src={row.lobby_background_image}/>) : null}
            <img
              alt={`${row.display_name} lobby preview`}
              className={styles.boardPreview}
              loading="lazy"
              src={row.preview_image}/>
            <div className={styles.boardStatus}>
              <StatusPill enabled={row.is_enabled}/>
            </div>
          </div>
          <div className={styles.boardBody}>
            <div className={styles.boardTitleRow}>
              <div className={styles.boardTitleBlock}>
                <h3 className={styles.boardName}>{row.display_name}</h3>
                <p className={styles.boardId}>{row.id}</p>
              </div>
              <div
                className={styles.boardActions}
                onClick={(event) => {
                  event.stopPropagation()
                }}>
                <button
                  className={styles.editButton}
                  type="button"
                  onClick={() => {
                    openEditBoard(row)
                  }}>
                  Edit
                </button>
                <button
                  className={styles.deleteButton}
                  disabled={!canManage || pendingKey === `board-delete-${row.id}`}
                  type="button"
                  onClick={() => {
                    void deleteBoardHandler(row)
                  }}>
                  Delete
                </button>
              </div>
            </div>
            <div className={styles.boardStats}>
              <div className={styles.statCell}>
                <div className={styles.statLabel}>Level</div>
                <div className={styles.statValue}>{row.unlock_level}</div>
              </div>
              <div className={styles.statCell}>
                <div className={styles.statLabel}>Coins</div>
                <div className={styles.statValue}>{formatNumber(row.price_coins)}</div>
              </div>
              <div className={styles.statCell}>
                <div className={styles.statLabel}>Gems</div>
                <div className={styles.statValue}>{formatNumber(row.price_gems ?? 0)}</div>
              </div>
              <div className={styles.statCell}>
                <div className={styles.statLabel}>Sort</div>
                <div className={styles.statValue}>{row.sort_order}</div>
              </div>
            </div>
          </div>
        </div>))}
      </div>)}

    {boardEditorOpen && (
      <div className={styles.modalOverlay}>
        <div className={styles.modalDialog}>
          <div className={styles.modalHeader}>
            <div>
              <div className={styles.modalEyebrow}>
                {boardEditorMode === "add" ? "Add Board" : "Edit Board"}
              </div>
              <h2 className={styles.modalTitle}>
                {boardEditorMode === "add" ? "New board theme" : boardDraft.display_name || "Board theme"}
              </h2>
            </div>
            <button
              className={styles.closeButton}
              type="button"
              onClick={() => {
                setBoardEditorOpen(false)
              }}>
              Close
            </button>
          </div>

          <div className={styles.modalFields}>
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
                <div className={styles.idError}>
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
          <div className={styles.modalImages}>
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
            <div className={styles.toggleGrid}>
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
            <div className={styles.modalFooter}>
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
