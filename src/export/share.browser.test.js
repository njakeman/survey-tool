import { describe, expect, test, vi } from 'vitest';
import { shareOrDownload } from './share.js';

function fakeFile() {
  return new File(['zip bytes'], 'ashton-keynes-2026-08-06.zip', { type: 'application/zip' });
}

describe('shareOrDownload', () => {
  test('shares the file when canShare reports it is shareable', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const navigatorLike = { canShare: () => true, share };
    const file = fakeFile();

    const result = await shareOrDownload(file, { navigatorLike, title: 'Ashton Keynes' });

    expect(share).toHaveBeenCalledWith({ files: [file], title: 'Ashton Keynes' });
    expect(result).toEqual({ method: 'share' });
  });

  test('treats a dismissed share sheet (AbortError) as a normal cancel, not a failure', async () => {
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const navigatorLike = { canShare: () => true, share: vi.fn().mockRejectedValue(abortError) };

    const result = await shareOrDownload(fakeFile(), { navigatorLike });

    expect(result).toEqual({ method: 'share', cancelled: true });
  });

  test('rethrows a genuine share failure (not AbortError)', async () => {
    const realError = new Error('something went wrong');
    const navigatorLike = { canShare: () => true, share: vi.fn().mockRejectedValue(realError) };

    await expect(shareOrDownload(fakeFile(), { navigatorLike })).rejects.toThrow(
      'something went wrong',
    );
  });

  test('falls back to a Blob download when Share is unavailable', async () => {
    const navigatorLike = {}; // no canShare at all
    const anchor = { click: vi.fn() };
    const createAnchor = vi.fn().mockReturnValue(anchor);
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    const revokeObjectURL = vi.fn();
    const setTimeoutFn = vi.fn();
    const file = fakeFile();

    const result = await shareOrDownload(file, {
      navigatorLike,
      createAnchor,
      createObjectURL,
      revokeObjectURL,
      setTimeoutFn,
    });

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(anchor.href).toBe('blob:fake-url');
    expect(anchor.download).toBe(file.name);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ method: 'download' });
  });

  test('falls back to download when canShare says the file is not shareable', async () => {
    const navigatorLike = { canShare: () => false, share: vi.fn() };
    const anchor = { click: vi.fn() };

    const result = await shareOrDownload(fakeFile(), {
      navigatorLike,
      createAnchor: () => anchor,
      createObjectURL: () => 'blob:fake-url',
      revokeObjectURL: vi.fn(),
      setTimeoutFn: vi.fn(),
    });

    expect(navigatorLike.share).not.toHaveBeenCalled();
    expect(result).toEqual({ method: 'download' });
  });

  test('schedules revoking the object URL after the download, not immediately', async () => {
    const revokeObjectURL = vi.fn();
    const setTimeoutFn = vi.fn();

    await shareOrDownload(fakeFile(), {
      navigatorLike: {},
      createAnchor: () => ({ click: vi.fn() }),
      createObjectURL: () => 'blob:fake-url',
      revokeObjectURL,
      setTimeoutFn,
    });

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
    setTimeoutFn.mock.calls[0][0](); // fire the scheduled callback
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
