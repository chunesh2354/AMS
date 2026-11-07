import { useState } from 'react';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { TextArea } from '../TextArea';

export type ThreadMessage = { id: string; author: string; text: string; time: string };
export type ThreadProps = { label: string; messages: ThreadMessage[]; onReply?: (text: string) => void };

/** Added for task review threads: messages in order, with a reply box. */
export function Thread({ label, messages, onReply }: ThreadProps) {
  const [draft, setDraft] = useState('');
  const [tried, setTried] = useState(false);
  const send = () => {
    if (!draft.trim()) { setTried(true); return; }
    onReply?.(draft.trim());
    setDraft('');
    setTried(false);
  };
  return (
    <div className="thread" role="group" aria-label={label}>
      {messages.length === 0
        ? <p className="t-body-sm ink-2">No review comments yet.</p>
        : (
          <ul className="thread__list">
            {messages.map((m) => (
              <li key={m.id} className="thread__row">
                <Avatar name={m.author} size={28} />
                <div className="thread__body">
                  <span className="thread__who"><strong>{m.author}</strong><time className="t-numeric ink-2">{m.time}</time></span>
                  <p className="t-body-sm">{m.text}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      {onReply && (
        <div className="thread__reply">
          <TextArea label="Reply" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} error={tried ? 'Write a reply first' : undefined} />
          <Button size="dense" onClick={send}>Reply</Button>
        </div>
      )}
    </div>
  );
}
