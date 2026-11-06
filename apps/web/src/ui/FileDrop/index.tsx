import { useId, useState, type DragEvent } from 'react';
import { Paperclip, UploadCloud } from 'lucide-react';
import { cx } from '../cx';

export type DroppedFile = { name: string; thumbnail?: string };

export type FileDropProps = {
  label: string;
  accept?: string;
  multiple?: boolean;
  files?: DroppedFile[];
  onFiles?: (files: File[]) => void;
  /** 0-100 while uploading. */
  progress?: number;
  error?: string;
  /** Forces the dragover look for documentation. */
  dragover?: boolean;
};

export function FileDrop({ label, accept, multiple, files = [], onFiles, progress, error, dragover }: FileDropProps) {
  const [over, setOver] = useState(false);
  const id = useId();
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); onFiles?.(Array.from(e.dataTransfer.files)); };
  return (
    <div className="field">
      <label
        htmlFor={id}
        className={cx('filedrop', (over || dragover) && 'filedrop--over', error && 'filedrop--error')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input id={id} type="file" className="sr-only" accept={accept} multiple={multiple} aria-invalid={error ? true : undefined} onChange={(e) => onFiles?.(Array.from(e.target.files ?? []))} />
        <UploadCloud size={20} strokeWidth={1.5} aria-hidden />
        <span className="t-h3">{label}</span>
        <span className="t-caption ink-2">Drop a file here or click to browse{accept ? ` (${accept})` : ''}</span>
        {progress != null && (
          <span className="progress" role="progressbar" aria-label="Uploading" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <span className="progress__bar" style={{ display: 'block', width: `${progress}%` }} />
          </span>
        )}
      </label>
      {error && <p className="field__error">{error}</p>}
      {files.length > 0 && (
        <ul className="filedrop__files">
          {files.map((f) => (
            <li key={f.name} className="filedrop__thumb">
              {f.thumbnail ? <img src={f.thumbnail} alt="" /> : <Paperclip size={16} strokeWidth={1.5} aria-hidden />}
              {f.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
