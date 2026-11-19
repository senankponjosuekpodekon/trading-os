import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Mt5ReadStatus } from '../Mt5ReadStatus';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
const get = api.get as jest.Mock;
const base = { checkedAt: '2026-11-19T12:00:00Z', mode: 'READ_ONLY', executionEnabled: false };
const ready = { ...base, status: 'READY', account: { balance: 10000, equity: 10000, margin: 0, marginFree: 10000, currency: 'USD' },
  positionsCount: 0, quote: { bid: 1.1, ask: 1.1001, time: 1795088316 },
  contract: { contractSize: 100000, volumeMin: 0.01, volumeStep: 0.01 } };

beforeEach(() => {
  jest.useFakeTimers();
  get.mockReset();
});
afterEach(() => jest.useRealTimers());

it('displays verified read-only data with no trading controls', async () => {
  get.mockResolvedValue({ data: ready });
  await act(async () => { render(<Mt5ReadStatus />); });
  expect(screen.getByRole('status')).toHaveTextContent('Démo connectée et vérifiée');
  expect(screen.getAllByText('10000.00 USD')).toHaveLength(3);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/admin/ops/mt5', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it.each([
  ['NOT_CONFIGURED', 'non configurée'], ['NOT_READY', 'non vérifiés'],
  ['UNAVAILABLE', 'indisponible'], ['INVALID_RESPONSE', 'invalide'], ['STALE_QUOTE', 'périmée'],
])('displays %s without stale balances', async (status, text) => {
  get.mockResolvedValue({ data: { ...base, status } });
  await act(async () => { render(<Mt5ReadStatus />); });
  expect(screen.getByRole('status')).toHaveTextContent(text);
  expect(screen.queryByText('Balance')).not.toBeInTheDocument();
});

it.each([null, {}, { ...ready, account: null }, { ...ready, executionEnabled: true },
  { ...base, status: '__proto__' }, { ...ready, quote: { ...ready.quote, time: 1e30 } },
  { ...ready, positionsCount: -1 }])('handles malformed data safely', async data => {
  get.mockResolvedValue({ data });
  await act(async () => { render(<Mt5ReadStatus />); });
  expect(screen.getByRole('status')).toHaveTextContent('Impossible de vérifier MT5');
});

it('polls and clears previous data when the API fails', async () => {
  get.mockResolvedValueOnce({ data: ready }).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { render(<Mt5ReadStatus />); });
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status')).toHaveTextContent('Impossible de vérifier MT5');
  expect(screen.queryByText('Balance')).not.toBeInTheDocument();
});

it('aborts and stops polling on unmount', async () => {
  get.mockResolvedValue({ data: ready });
  const view = render(<Mt5ReadStatus />);
  await act(async () => {});
  const signal = get.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(get).toHaveBeenCalledTimes(1);
});
