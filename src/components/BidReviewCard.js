'use client';

export default function BidReviewCard({ bid, onApprove, onReject, approving = false }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-slate-400 mb-1">{bid.bid_number || 'N/A'}</div>
          <h3 className="text-[14px] font-bold text-slate-900 leading-snug">{bid.description || 'Untitled Bid'}</h3>
          <div className="text-[12px] text-slate-500 mt-1">{bid.agency || 'Unknown Agency'}</div>
        </div>
        <span className="text-[11px] px-2 py-1 rounded-md bg-slate-100 text-slate-600 whitespace-nowrap">
          {bid.status || 'Open'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-[12px]">
        <div>
          <div className="text-slate-400">Due</div>
          <div className="text-slate-700 font-medium">{bid.due_date || '-'}</div>
        </div>
        <div>
          <div className="text-slate-400">Buyer</div>
          <div className="text-slate-700 font-medium">{bid.buyer || '-'}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          onClick={() => onApprove(bid)}
          disabled={approving}
          className="py-2.5 min-h-[42px] rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-50"
        >
          {approving ? 'Saving...' : '✅ Approve'}
        </button>
        <button
          onClick={() => onReject(bid)}
          className="py-2.5 min-h-[42px] rounded-lg border border-slate-200 text-slate-600 text-[12px] font-semibold hover:bg-slate-50"
        >
          ❌ Reject
        </button>
        <a
          href={bid.detail_url || '#'}
          target="_blank"
          rel="noreferrer"
          className="py-2.5 min-h-[42px] rounded-lg border border-blue-200 text-blue-600 text-[12px] font-semibold text-center hover:bg-blue-50"
        >
          👁️ View
        </a>
      </div>
    </div>
  );
}
