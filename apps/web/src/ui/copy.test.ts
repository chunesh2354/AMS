import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { copyText, useCopy } from './copy';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExec = (document as unknown as { execCommand?: unknown }).execCommand;

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}
function setExec(fn: ((cmd: string) => boolean) | undefined) {
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true, writable: true });
}

describe('copyText', () => {
  beforeEach(() => { setExec(undefined); });
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else setClipboard(undefined);
    setExec(originalExec as ((cmd: string) => boolean) | undefined);
    vi.useRealTimers();
  });

  it('uses the Clipboard API when it works, without the fallback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const exec = vi.fn(() => true);
    setClipboard({ writeText });
    setExec(exec);
    expect(await copyText('https://x.test/accept-invite/abc')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://x.test/accept-invite/abc');
    expect(exec).not.toHaveBeenCalled();
  });

  it('falls back to a temporary textarea and execCommand when the Clipboard API is blocked', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) });
    let copied = '';
    const exec = vi.fn((cmd: string) => {
      const el = document.activeElement as HTMLTextAreaElement;
      copied = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
      return cmd === 'copy';
    });
    setExec(exec);
    const before = document.querySelectorAll('textarea').length;
    expect(await copyText('the-link')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(copied).toBe('the-link');
    expect(document.querySelectorAll('textarea').length).toBe(before);
  });

  it('falls back when there is no Clipboard API at all', async () => {
    setClipboard(undefined);
    setExec(vi.fn(() => true));
    expect(await copyText('x')).toBe(true);
  });

  it('returns false, without throwing, when both ways fail', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('blocked')) });
    setExec(vi.fn(() => false));
    expect(await copyText('x')).toBe(false);
    setExec(vi.fn(() => { throw new Error('nope'); }));
    expect(await copyText('x')).toBe(false);
    setExec(undefined);
    expect(await copyText('x')).toBe(false);
  });

  it('useCopy says Copied for two seconds, and selects the field when copying is blocked', async () => {
    vi.useFakeTimers();
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useCopy());
    await act(async () => { await result.current.copy('x'); });
    expect(result.current.state).toBe('copied');
    act(() => { vi.advanceTimersByTime(1999); });
    expect(result.current.state).toBe('copied');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.state).toBe('idle');

    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('blocked')) });
    setExec(vi.fn(() => false));
    const input = document.createElement('input');
    input.id = 'invite-field';
    input.value = 'https://x.test/accept-invite/abc';
    document.body.appendChild(input);
    await act(async () => { await result.current.copy(input.value, 'invite-field'); });
    expect(result.current.state).toBe('blocked');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    input.remove();
  });
});
