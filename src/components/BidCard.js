'use client';

import { useMemo, useState } from 'react';

const STATUS_STYLES = {
  New: { c: '#3B82F6', bg: '#EFF6FF' },
  Reviewing: { c: '#8B5CF6', bg: '#F5F3FF' },
  Submitted: { c: '#10B981', bg: '#ECFDF5' },
  Won: { c: '#059669', bg: '#D1FAE5' },
  Lost: { c: '#EF4444', bg: '#FEF2F2' },
  Archived: { c: '#6B7280', bg: '#F3F4F6' },
};

const STATUS_OPTIONS = ['New', 'Reviewing', 'Submitted', 'Won', 'Lost', 'Archived'];

function Badge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.New;
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap"
      style={{ background: s.bg, color: s.c }}
    >
      {status}
    </span>
  );
}

export default function BidCard({ bid, onStatusChange, onSaveNotes, onArchiveToggle, saving = false }) {
  const [notes, setNotes] = useState(bid.notes || '');

  const isArchived = useMemo(
    () => bid.status === 'Archived' || bid.archived === true || bid.archived === 'TRUE',
    [bid]
  );

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[12px] text-slate-400 mb-1">{bid.id}</div>
          <h2 className="text-[17px] font-extrabold text-slate-900 mb-1">{bid.name}</h2>
          <div className="text-[14px] text-slate-500">{bid.client}</div>
        </div>
        <Badge status={bid.status || 'New'} />
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Status</label>
          <select
            value={bid.status || 'New'}
            onChange={(e) => onStatusChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[13px] text-slate-700 outline-none bg-slate-50"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={() => onArchiveToggle(!isArchived)}
            className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-[13px] font-semibold hover:bg-slate-50"
          >
            {isArchived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Internal Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes for your team..."
          className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[13px] text-slate-700 outline-none bg-slate-50 min-h-[110px] resize-y"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => onSaveNotes(notes)}
            disabled={saving}
            className="px-4 py-2.5 rounded-lg bg-navy-500 text-white text-[13px] font-bold hover:bg-navy-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  );
}
