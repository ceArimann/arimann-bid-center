'use client';

import { useEffect, useMemo, useState } from 'react';
import BidReviewCard from '@/components/BidReviewCard';

const FILTERS = ['All', 'Janitorial', 'Custodial', 'Cleaning'];

function includesKeyword(bid, keyword) {
  const k = keyword.toLowerCase();
  const text = [
    bid.description,
    bid.agency,
    bid.bid_number,
    bid.status,
    bid.buyer,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes(k);
}

export default function CommBuysFeed() {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [approvingIds, setApprovingIds] = useState(new Set());

  const loadFeed = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/commbuys', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load feed');
      setBids(data.bids || []);
    } catch (err) {
      setError(err.message || 'Unable to load CommBuys feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed();
  }, []);

  const visibleBids = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bids.filter((bid) => {
      if (hiddenIds.has(bid.bid_number)) return false;
      if (filter !== 'All' && !includesKeyword(bid, filter)) return false;
      if (!q) return true;
      return [bid.bid_number, bid.description, bid.agency, bid.status, bid.buyer]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [bids, hiddenIds, filter, search]);

  const onReject = (bid) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(bid.bid_number);
      return next;
    });
  };

  const onApprove = async (bid) => {
    const bidId = bid.bid_number;
    setApprovingIds((prev) => new Set(prev).add(bidId));

    try {
      const res = await fetch('/api/commbuys/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bid, status: 'New' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Approve failed');
      }

      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(bidId);
        return next;
      });
    } catch (err) {
      alert(err.message || 'Unable to approve bid');
    } finally {
      setApprovingIds((prev) => {
        const next = new Set(prev);
        next.delete(bidId);
        return next;
      });
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100">
      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                filter === f
                  ? 'bg-navy-500 text-white'
                  : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex gap-2 w-full md:w-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search CommBuys bids..."
            className="w-full md:w-72 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[13px] outline-none text-slate-700"
          />
          <button
            onClick={loadFeed}
            className="px-3 py-2.5 min-h-[42px] rounded-lg border border-slate-200 text-[13px] text-slate-500 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && <div className="p-8 text-center text-slate-400 text-[13px]">Loading CommBuys feed...</div>}
      {!loading && error && <div className="p-8 text-center text-red-500 text-[13px]">{error}</div>}

      {!loading && !error && (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Bid #', 'Description', 'Agency', 'Due', 'Status', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="text-left px-3.5 py-2.5 text-[11px] font-bold text-slate-500 tracking-wide border-b border-slate-100 bg-slate-50/50"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleBids.map((bid) => (
                  <tr key={bid.bid_number} className="border-b border-slate-50">
                    <td className="px-3.5 py-3 font-mono text-[12px] text-slate-500">{bid.bid_number}</td>
                    <td className="px-3.5 py-3 text-[13px] font-semibold text-slate-800">{bid.description || '-'}</td>
                    <td className="px-3.5 py-3 text-[13px] text-slate-600">{bid.agency || '-'}</td>
                    <td className="px-3.5 py-3 text-[13px] text-slate-600">{bid.due_date || '-'}</td>
                    <td className="px-3.5 py-3 text-[12px] text-slate-600">{bid.status || '-'}</td>
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onApprove(bid)}
                          disabled={approvingIds.has(bid.bid_number)}
                          className="px-2.5 py-1.5 rounded-md bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {approvingIds.has(bid.bid_number) ? 'Saving...' : '✅ Approve'}
                        </button>
                        <button
                          onClick={() => onReject(bid)}
                          className="px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 text-[12px] font-semibold hover:bg-slate-50"
                        >
                          ❌ Reject
                        </button>
                        <a
                          href={bid.detail_url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1.5 rounded-md border border-blue-200 text-blue-600 text-[12px] font-semibold hover:bg-blue-50"
                        >
                          👁️ View
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden p-3 space-y-3">
            {visibleBids.map((bid) => (
              <BidReviewCard
                key={bid.bid_number}
                bid={bid}
                onApprove={onApprove}
                onReject={onReject}
                approving={approvingIds.has(bid.bid_number)}
              />
            ))}
          </div>

          {visibleBids.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-[13px]">No CommBuys bids match your filters.</div>
          )}
        </>
      )}
    </div>
  );
}
