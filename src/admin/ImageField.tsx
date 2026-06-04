import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
// Storage uploads must run as the signed-in operator, so use the BO's own
// authenticated client (adminSupabase) — NOT the main game client, which in
// the operator's browser holds only the anonymous guest session. Uploading via
// the guest client runs the storage INSERT as `anon`, which can't execute the
// board-assets RLS policy's private.current_admin_role() check and fails with
// "permission denied for function current_admin_role".
import { adminSupabase as supabase } from '../lib/adminSupabase';

const BUCKET = 'board-assets';
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB — matches the bucket policy
const ALLOWED_MIME = new Set([
  'image/webp',
  'image/png',
  'image/jpeg',
  'image/avif',
  'image/gif',
  'image/svg+xml',
]);

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; name: string }
  | { kind: 'error'; message: string };

interface Props {
  label: string;
  value: string;
  onChange(value: string): void;
  /** Sub-folder inside the board-assets bucket. Keeps uploads tidy
   *  (e.g. boardSlug/preview.webp). Falls back to "misc". */
  folder?: string;
  /** Stable kind suffix appended to the uploaded filename so files
   *  from different fields don't collide (e.g. "preview", "checker-
   *  white"). Falls back to a timestamp. */
  kind?: string;
  disabled?: boolean;
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/avif':
      return 'avif';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'bin';
  }
}

function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'asset'
  );
}

/**
 * Drag-and-drop / file-picker image field for the admin board editor.
 * Uploads to the public `board-assets` Supabase Storage bucket and
 * writes the resulting public URL back into the form via `onChange`.
 * Falls back to a collapsible plain-text URL input for cases where
 * the asset is already hosted elsewhere (CDN, prior upload, etc.).
 */
export default function ImageField({
  label,
  value,
  onChange,
  folder,
  kind,
  disabled = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [showUrl, setShowUrl] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (!ALLOWED_MIME.has(file.type)) {
      setState({
        kind: 'error',
        message: `Unsupported type "${file.type || 'unknown'}". Use webp / png / jpg / avif / gif / svg.`,
      });
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setState({
        kind: 'error',
        message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MiB; max is ${(MAX_SIZE_BYTES / 1024 / 1024).toFixed(0)} MiB.`,
      });
      return;
    }

    setState({ kind: 'uploading', name: file.name });

    const folderSlug = slug(folder ?? 'misc');
    const kindSlug = kind ? slug(kind) : `${Date.now()}`;
    const ext = extFromMime(file.type);
    // Add a short random suffix so re-uploads under the same kind don't
    // collide with the prior public URL (which the browser caches).
    const stamp = Date.now().toString(36).slice(-4);
    const path = `${folderSlug}/${kindSlug}-${stamp}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type,
      });

    if (error) {
      setState({
        kind: 'error',
        message: error.message || 'Upload failed. Check that you have admin privileges.',
      });
      return;
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) {
      setState({
        kind: 'error',
        message: 'Upload succeeded but no public URL was returned.',
      });
      return;
    }

    onChange(data.publicUrl);
    setState({ kind: 'idle' });
  };

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (disabled || state.kind === 'uploading') return;
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled || state.kind === 'uploading') return;
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const clear = () => {
    onChange('');
    setState({ kind: 'idle' });
  };

  const isUploading = state.kind === 'uploading';
  const hasValue = value.trim().length > 0;

  return (
    <div className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {hasValue && (
          <button
            type="button"
            onClick={clear}
            disabled={disabled || isUploading}
            className="rounded border border-white/15 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-white/60 transition hover:border-rose-300/40 hover:text-rose-200 disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        className={`mt-1 flex items-center gap-3 rounded-lg border border-dashed px-3 py-2 transition ${
          dragOver
            ? 'border-amber-200/70 bg-amber-200/5'
            : 'border-white/15 bg-black/20 hover:border-white/30'
        } ${disabled || isUploading ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
      >
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-black/40">
          {hasValue ? (
            <img
              src={value}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
            />
          ) : (
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">
              No image
            </span>
          )}
        </div>
        <div className="flex-1 normal-case tracking-normal">
          {isUploading ? (
            <div className="text-xs text-amber-100">
              Uploading {state.name}…
            </div>
          ) : state.kind === 'error' ? (
            <div className="text-xs text-rose-200">{state.message}</div>
          ) : hasValue ? (
            <div className="break-all text-[11px] text-white/55">{value}</div>
          ) : (
            <div className="text-xs text-white/45">
              Drop an image here, or click to browse
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/webp,image/png,image/jpeg,image/avif,image/gif,image/svg+xml"
          onChange={onFilePicked}
          disabled={disabled || isUploading}
          className="hidden"
        />
      </div>

      <button
        type="button"
        onClick={() => setShowUrl((v) => !v)}
        className="mt-1 text-[10px] font-bold normal-case tracking-normal text-white/35 transition hover:text-white/70"
      >
        {showUrl ? 'Hide URL' : 'Or paste a URL'}
      </button>
      {showUrl && (
        <input
          type="text"
          value={value}
          disabled={disabled || isUploading}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://…"
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60 disabled:opacity-50"
        />
      )}
    </div>
  );
}
