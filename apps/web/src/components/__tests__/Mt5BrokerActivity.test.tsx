import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/lib/api';
import { Mt5BrokerActivity } from '../Mt5BrokerActivity';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
const get = api.get as jest.Mock;
const now = '2026-11-19T12:00:00Z';
const page = { items: [], total: 0, limit: 100, nextOffset: null };
const ready = {
  mode: 'READ_ONLY', executionEnabled: false, checkedAt: now, status: 'READY', brokerCheckedAt: now,
  period: { from: '2026-11-12T12:00:00Z', to: now }, currency: 'USD',
  pendingOrders: page, historyOrders: page, deals: page,
  contract: { point: 0.00001, tick_size: 0.00001, tick_value_profit: 1, tick_value_loss: 1,
    volume_min: 0.01, volume_max: 50, volume_step: 0.01, stops_level: 10, freeze_level: 0,
    contract_size: 100000, currency_profit: 'USD', currency_margin: 'EUR' },
};
beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(now)); get.mockReset(); });
afterEach(() => jest.useRealTimers());
async function toggle(open = true) {
  await act(async () => {
    const details = screen.getByText('Ordres, historique et spécifications broker').closest('details')!;
    details.open = open;
    fireEvent(details, new Event('toggle'));
  });
}

it('does not request history until explicitly expanded', async () => {
  await act(async () => { render(<Mt5BrokerActivity />); });
  expect(get).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('shows verified empty collections and contract details without trading controls', async () => {
  get.mockResolvedValue({ data: ready });
  render(<Mt5BrokerActivity />);
  await toggle();
  expect(screen.getByRole('status')).toHaveTextContent('Lectures broker vérifiées');
  expect(screen.getByText('Ordres en attente (0)')).toBeInTheDocument();
  expect(screen.getAllByText('Aucun enregistrement dans ce relevé.')).toHaveLength(3);
  expect(screen.getByText(/ne valident ni le sizing/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/admin/ops/mt5/activity', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it.each([null, {}, { ...ready, executionEnabled: true }, { ...ready, pendingOrders: null },
  { ...ready, checkedAt: '2026-11-18T12:00:00Z' }])('rejects malformed or stale snapshots without showing false zeros', async data => {
  get.mockResolvedValue({ data });
  render(<Mt5BrokerActivity />);
  await toggle();
  expect(screen.getByRole('status')).toHaveTextContent('ancien relevé masqué');
  expect(screen.queryByText('Ordres en attente (0)')).not.toBeInTheDocument();
});

it('clears the previous snapshot on errors and stops polling when collapsed', async () => {
  get.mockResolvedValueOnce({ data: ready }).mockRejectedValueOnce(new Error('offline'));
  render(<Mt5BrokerActivity />);
  await toggle();
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(screen.queryByText('Spécifications EURUSD')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('ancien relevé masqué');
  await toggle(false);
  expect(get.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(get).toHaveBeenCalledTimes(2);
});

it('renders exact large tickets, UTC timestamps and deal costs', async () => {
  const order = { ticket: '9007199254740993', position_id: '0', symbol: 'EURUSD', type: 2, state: 1,
    time_setup_msc: Date.parse(now), time_done_msc: 0, volume_initial: 0.01, volume_current: 0.01,
    price_open: 1.1, sl: 1.08, tp: 1.12 };
  const deal = { ticket: '3', order: order.ticket, position_id: '4', symbol: 'EURUSD', type: 0, entry: 1,
    time_msc: Date.parse(now), volume: 0.01, price: 1.11, commission: -0.5, swap: 0, fee: 0, profit: 10 };
  get.mockResolvedValue({ data: { ...ready,
    pendingOrders: { ...page, items: [order], total: 1 }, deals: { ...page, items: [deal], total: 1 } } });
  render(<Mt5BrokerActivity />);
  await toggle();
  expect(screen.getAllByText('9007199254740993')).toHaveLength(2);
  expect(screen.getByText('BUY LIMIT')).toBeInTheDocument();
  expect(screen.getByText('Sortie')).toBeInTheDocument();
  expect(screen.getByText('-0.5')).toBeInTheDocument();
  expect(screen.getAllByText('2026-11-19 12:00:00 UTC')).toHaveLength(2);
});

it('labels a balance operation without presenting it as a buy or sell', async () => {
  const balance = { ticket: '3', order: '0', position_id: '0', symbol: '', type: 2, entry: 0,
    time_msc: Date.parse(now), volume: 0, price: 0, commission: 0, swap: 0, fee: 0, profit: 10000 };
  get.mockResolvedValue({ data: { ...ready, deals: { ...page, items: [balance], total: 1 } } });
  render(<Mt5BrokerActivity />);
  await toggle();
  expect(screen.getByText('Solde')).toBeInTheDocument();
  expect(screen.queryByText('BUY')).not.toBeInTheDocument();
  expect(screen.queryByText('SELL')).not.toBeInTheDocument();
});

it('labels capped histories as partial rather than complete', async () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ ticket: String(i + 1), position_id: String(i + 1), symbol: 'EURUSD', type: 0, state: 4,
    time_setup_msc: Date.parse(now), time_done_msc: Date.parse(now), volume_initial: 0.01, volume_current: 0,
    price_open: 1.1, sl: 1.08, tp: 1.12 }));
  get.mockResolvedValue({ data: { ...ready, historyOrders: { ...page, items, total: 120, nextOffset: 100 } } });
  render(<Mt5BrokerActivity />);
  await toggle();
  expect(screen.getByText('Lecture partielle : 100 dernières lignes sur 120.')).toBeInTheDocument();
});

it('keeps zero tick values visibly unusable for sizing', async () => {
  get.mockResolvedValue({ data: { ...ready, contract: { ...ready.contract, tick_value_loss: 0 } } });
  render(<Mt5BrokerActivity />);
  await toggle();
  expect(screen.getByText('Indisponible pour sizing')).toBeInTheDocument();
});

it('shows broker error codes without rendering a successful empty account', async () => {
  get.mockResolvedValue({ data: { mode: 'READ_ONLY', executionEnabled: false, checkedAt: now, status: 'UNAVAILABLE', brokerErrorCode: -10004 } });
  render(<Mt5BrokerActivity />);
  await toggle();
  expect(screen.getByRole('status')).toHaveTextContent('-10004');
  expect(screen.queryByText('Ordres en attente (0)')).not.toBeInTheDocument();
});
