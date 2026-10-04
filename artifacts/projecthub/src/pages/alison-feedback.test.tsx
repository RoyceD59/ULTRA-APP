import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlisonFeedbackPage from './alison-feedback';
import { createHighlightPattern } from '@/components/highlighted-text';

const items = [
  { id: 1, ts: new Date().toISOString(), rating: 'down', question: 'FILTER costs for C++ (test)?', answer: 'A filter costs KES 500. C++ (test) is literal.' },
  { id: 2, ts: new Date().toISOString(), rating: 'down', question: 'Installation help', answer: `${'Instructions. '.repeat(25)}FILTER costs KES 500.` },
];

beforeEach(() => {
  localStorage.setItem('projecthub:token', 'test-session');
  window.history.replaceState(null, '', '/alison-feedback');
  vi.stubGlobal('fetch', vi.fn(async (input: string) => ({
    ok: true,
    json: async () => input.includes('/topics')
      ? { keywords: [['filter', 2]], totalDown: 2, mostFlagged: null }
      : { items, count: items.length, totalInLog: items.length, weekStats: { total: 2, up: 0, down: 2 } },
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function marks(container: HTMLElement) {
  return [...container.querySelectorAll('mark')].map(mark => mark.textContent);
}

describe('feedback match highlighting', () => {
  it('highlights chip matches in questions and answers, including expanded answers', async () => {
    const { container } = render(<AlisonFeedbackPage />);
    await screen.findByText('Installation help');
    expect(marks(container)).toEqual([]);
    fireEvent.click(await screen.findByTitle('Filter entries by "filter"'));
    await waitFor(() => expect(marks(container)).toEqual(['FILTER', 'filter']));
    fireEvent.click(screen.getByText('Show full answer'));
    expect(marks(container)).toEqual(['FILTER', 'filter', 'FILTER']);
    fireEvent.click(screen.getByText('Show less'));
    expect(marks(container)).toEqual(['FILTER', 'filter']);
    fireEvent.click(screen.getByLabelText('Clear keyword filter'));
    await waitFor(() => expect(marks(container)).toEqual([]));
  });

  it('supports trimmed literal search, both filters together, and clearing search', async () => {
    const { container } = render(<AlisonFeedbackPage />);
    await screen.findByText('Installation help');
    const search = screen.getByPlaceholderText('Search entries…');
    fireEvent.change(search, { target: { value: '  C++ (test)  ' } });
    expect(marks(container)).toEqual(['C++ (test)', 'C++ (test)']);
    expect(screen.queryByText('Installation help')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTitle('Filter entries by "filter"'));
    await waitFor(() => expect(marks(container)).toEqual(['FILTER', 'C++ (test)', 'filter', 'C++ (test)']));
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(marks(container)).toEqual(['FILTER', 'filter']);
    fireEvent.change(search, { target: { value: 'missing phrase' } });
    expect(marks(container)).toEqual([]);
    expect(screen.getByText(/No unhelpful entries match/)).toBeInTheDocument();
  });

  it('highlights the whole search phrase when it starts with the chip keyword', async () => {
    const { container } = render(<AlisonFeedbackPage />);
    await screen.findByText('Installation help');
    fireEvent.click(await screen.findByTitle('Filter entries by "filter"'));
    fireEvent.change(screen.getByPlaceholderText('Search entries…'), { target: { value: 'filter costs' } });
    await waitFor(() => expect(marks(container)).toEqual(['FILTER costs', 'filter costs']));
  });

  it('restores keyword highlights from a bookmarked URL', async () => {
    window.history.replaceState(null, '', '/alison-feedback?keyword=filter');
    const { container } = render(<AlisonFeedbackPage />);
    await screen.findByText('Installation help');
    expect(marks(container)).toEqual(['FILTER', 'filter']);
  });

  it('keeps a shared matcher stateless across a large result set', () => {
    const pattern = createHighlightPattern(['filter', ' FILTER ', 'filter costs']);
    expect(pattern).not.toBeNull();
    for (let i = 0; i < 10_000; i++) {
      expect('FILTER costs and filter'.split(pattern!)).toEqual(['', 'FILTER costs', ' and ', 'filter', '']);
    }
    expect(pattern!.lastIndex).toBe(0);
    expect(createHighlightPattern([null, '', '  '])).toBeNull();
  });
});