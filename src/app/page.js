'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import AuthProvider from '@/components/AuthProvider';
import CommBuysFeed from '@/components/CommBuysFeed';
import { fetchBids, addBid as apiAddBid, updateBidStatus } from '@/lib/sheets';

// ─── Status config ───
const SC = {
  Open: { c: '#3B82F6', bg: '#EFF6FF' },
  'Walkthrough Scheduled': { c: '#8B5CF6', bg: '#F5F3FF' },
  'In Progress': { c: '#F59E0B', bg: '#FFFBEB' },
  Submitted: { c: '#10B981', bg: '#ECFDF5' },
  Won: { c: '#059669', bg: '#D1FAE5' },
  Lost: { c: '#EF4444', bg: '#FEF2F2' },
  'No Bid': { c: '#6B7280', bg: '#F3F4F6' },
  'On Hold': { c: '#6366F1', bg: '#EEF2FF' },
};
const ACT = ['Open', 'Walkthrough Scheduled', 'In Progress', 'Submitted'];
const ALL_S = Object.keys(SC);

// ─── Utilities ───
const du = (d) => (d ? Math.ceil((new Date(d) - new Date()) / 864e5) : 999);
const fd = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-');
const fdt = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-');
const fs = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-');

// ─── Badge ───
function Badge({ status }) {
  const s = SC[status] || SC.Open;
  return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap" style={{ background: s.bg, color: s.c }}>{status}</span>;
}

// ─── Main App (inside auth) ───
function BidCenter() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [calMo, setCalMo] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  // Redirect to login if not authenticated
  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login');
  }, [authStatus, router]);

  // Fetch bids from Google Sheets
  const loadBids = useCallback(async () => {
    setLoading(true);
    const data = await fetchBids();
    // Normalize field names
    setBids(data.map(b => ({
      id: b.bidId || '',
      name: b.bidName || '',
      client: b.client || '',
      due: b.dueDate || '',
      walk: b.walkDateTime || '',
      walkLoc: b.walkLocation || '',
      owner: b.ownerName || '',
      ownerEmail: b.ownerEmail || '',
      status: b.status || 'Open',
      notes: b.notes || '',
      driveFolderUrl: b.driveFolderUrl || '',
      draftUrl: b.draftUrl || '',
      finalUrl: b.finalUrl || '',
      rfpUrl: b.rfpInFolderUrl || b.rfpFileUrl || '',
      bidUrl: b.bidUrl || '',
    })));
    setLoading(false);
  }, []);

  useEffect(() => { loadBids(); }, [loadBids]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(loadBids, 120000);
    return () => clearInterval(interval);
  }, [loadBids]);

  // Stats
  const stats = useMemo(() => {
    const act = bids.filter(b => ACT.includes(b.status));
    const d7 = act.filter(b => { const d = du(b.due); return d >= 0 && d <= 7; });
    const ar = d7.filter(b => b.status !== 'Submitted');
    const w = bids.filter(b => b.status === 'Won').length;
    const l = bids.filter(b => b.status === 'Lost').length;
    return { active: act.length, dueIn7: d7.length, atRisk: ar.length, winRate: (w + l) > 0 ? Math.round(w / (w + l) * 100) : 0, won: w, lost: l };
  }, [bids]);

  const filtered = useMemo(() => bids.filter(b => {
    if (filter !== 'all' && b.status !== filter) return false;
    if (search) { const q = search.toLowerCase(); return b.name.toLowerCase().includes(q) || b.client.toLowerCase().includes(q) || b.id.toLowerCase().includes(q); }
    return true;
  }), [bids, filter, search]);

  const atRisk = bids.filter(b => ACT.includes(b.status) && b.status !== 'Submitted' && du(b.due) >= 0 && du(b.due) <= 7);
  const walks = bids.filter(b => b.walk && du(b.walk) >= -1).sort((a, b) => new Date(a.walk) - new Date(b.walk)).slice(0, 5);

  const handleAddBid = async (formData) => {
    const result = await apiAddBid({
      bidName: formData.name,
      client: formData.client,
      dueDate: formData.due,
      walkDateTime: formData.walk,
      walkLocation: formData.walkLoc,
      ownerName: formData.owner,
      ownerEmail: formData.ownerEmail || session?.user?.email || '',
      notes: formData.notes,
      status: 'Open',
    });
    if (result.success) {
      setShowForm(false);
      loadBids(); // Refresh from sheet
    }
    return result;
  };

  const handleStatusUpdate = async (bidId, newStatus) => {
    await updateBidStatus(bidId, newStatus);
    loadBids();
    setSel(null);
  };

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <img src="/logo.png" alt="Arimann" className="w-32 mx-auto mb-4 animate-pulse" />
          <p className="text-slate-500">Loading bids...</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  // Calendar helpers
  const dim = new Date(calMo.getFullYear(), calMo.getMonth() + 1, 0).getDate();
  const startDay = calMo.getDay();
  const calLabel = calMo.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  const bidsForDay = (day) => {
    const ds = calMo.getFullYear() + '-' + String(calMo.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    return bids.filter(b => (b.due || '').substring(0, 10) === ds || (b.walk || '').substring(0, 10) === ds);
  };

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      {/* ── SIDEBAR ── */}
      <nav className="w-[230px] min-w-[230px] bg-navy-800 flex flex-col border-r border-white/5">
        <div className="flex items-center gap-3 p-4 border-b border-white/5">
          <img src="/logo.png" alt="Arimann" className="w-10 h-10 rounded-lg object-contain bg-white/10 p-0.5" />
          <div>
            <div className="text-[13px] font-extrabold text-slate-200 tracking-widest">ARIMANN</div>
            <div className="text-[9px] text-slate-500">Bid Command Center</div>
          </div>
        </div>
        <div className="p-3">
          {[['dashboard', 'Dashboard'], ['pipeline', 'Pipeline'], ['bids', 'All Bids'], ['commbuys', 'CommBuys Feed'], ['calendar', 'Calendar']].map(([id, label]) => (
            <button key={id} onClick={() => { setView(id); setSel(null); }} className={`nav-btn flex items-center gap-2.5 w-full py-2 px-3 rounded-lg text-[13px] mb-0.5 text-left transition-colors ${view === id ? 'active bg-blue-500/15 text-blue-400 font-semibold' : 'text-slate-400'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="px-4 mt-2">
          <div className="text-[10px] font-bold text-slate-600 tracking-wider mb-2">QUICK STATS</div>
          <div className="text-[13px] text-slate-400 mb-1"><strong>{stats.active}</strong> Active</div>
          <div className={`text-[13px] mb-1 ${stats.atRisk > 0 ? 'text-red-400' : 'text-slate-400'}`}><strong>{stats.atRisk}</strong> At Risk</div>
          <div className="text-[13px] text-slate-400"><strong>{stats.winRate}%</strong> Win Rate</div>
        </div>
        <div className="mt-auto p-3.5 border-t border-white/5">
          <div className="flex items-center gap-2.5">
            {session.user?.image ? (
              <img src={session.user.image} alt="" className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-navy-500 flex items-center justify-center text-[11px] font-bold text-blue-400">
                {(session.user?.name || '?')[0]}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-slate-200 truncate">{session.user?.name}</div>
              <div className="text-[10px] text-slate-500 truncate">{session.user?.email}</div>
            </div>
            <button onClick={() => signOut()} className="text-[10px] text-slate-500 hover:text-red-400 transition-colors" title="Sign out">Exit</button>
          </div>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex justify-between items-center px-6 py-4 bg-white border-b border-slate-200 shrink-0">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">{view === 'dashboard' ? 'Dashboard' : view === 'pipeline' ? 'Pipeline' : view === 'bids' ? 'All Bids' : view === 'commbuys' ? 'CommBuys Feed' : 'Calendar'}</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">{stats.active} active bids</p>
          </div>
          <div className="flex gap-2.5 items-center">
            <input className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[13px] outline-none w-44 text-slate-700" placeholder="Search bids..." value={search} onChange={e => setSearch(e.target.value)} />
            <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-navy-500 text-white text-[13px] font-bold hover:bg-navy-600 transition-colors whitespace-nowrap">+ New Bid</button>
            <button onClick={loadBids} className="px-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-500 hover:bg-slate-50" title="Refresh">Refresh</button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {/* ── DASHBOARD ── */}
          {view === 'dashboard' && <>
            <div className="grid grid-cols-6 gap-3 mb-5">
              {[['Active Bids', stats.active, '#3B82F6'], ['Due 7 Days', stats.dueIn7, '#F59E0B'], ['At Risk', stats.atRisk, stats.atRisk > 0 ? '#EF4444' : '#10B981'], ['Win Rate', stats.winRate + '%', '#10B981'], ['Won', stats.won, '#059669'], ['Lost', stats.lost, '#EF4444']].map(([l, v, a]) => (
                <div key={l} className="bg-white rounded-xl p-4 relative overflow-hidden border border-slate-100">
                  <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: a }} />
                  <div className="text-2xl font-extrabold text-slate-900">{v}</div>
                  <div className="text-[12px] text-slate-500">{l}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="bg-white rounded-xl border border-slate-100">
                <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100">
                  <span className="text-[14px] font-bold text-slate-900">At-Risk Bids</span>
                  <span className="text-[11px] text-slate-400">Due 7d, not submitted</span>
                </div>
                {atRisk.length === 0 ? <div className="p-7 text-center text-slate-400 text-[13px]">All clear!</div> : atRisk.map(b => (
                  <div key={b.id} onClick={() => setSel(b)} className="bid-row flex justify-between items-center px-4 py-3 border-b border-slate-50 cursor-pointer">
                    <div><div className="text-[13px] font-semibold text-slate-800">{b.name}</div><div className="text-[11px] text-slate-400">{b.client}</div></div>
                    <Badge status={b.status} />
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border border-slate-100">
                <div className="px-4 py-3 border-b border-slate-100"><span className="text-[14px] font-bold text-slate-900">Upcoming Walkthroughs</span></div>
                {walks.length === 0 ? <div className="p-7 text-center text-slate-400 text-[13px]">None scheduled.</div> : walks.map(b => (
                  <div key={b.id} onClick={() => setSel(b)} className="bid-row flex justify-between items-center px-4 py-3 border-b border-slate-50 cursor-pointer">
                    <div><div className="text-[13px] font-semibold text-slate-800">{b.name}</div><div className="text-[11px] text-slate-400">{b.walkLoc}</div></div>
                    <div className="text-[12px] text-slate-500">{fdt(b.walk)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-100">
              <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100">
                <span className="text-[14px] font-bold text-slate-900">Recent Bids</span>
                <button onClick={() => setView('bids')} className="text-[13px] font-semibold text-blue-500 hover:text-blue-600">View All</button>
              </div>
              <BidTable bids={filtered.slice(0, 8)} onSelect={setSel} />
            </div>
          </>}

          {/* ── PIPELINE ── */}
          {view === 'pipeline' && (
            <div className="grid grid-cols-4 gap-3.5">
              {['Open', 'Walkthrough Scheduled', 'In Progress', 'Submitted'].map(stage => {
                const sb = bids.filter(b => b.status === stage);
                return (
                  <div key={stage} className="bg-slate-50 rounded-xl p-2.5">
                    <div className="flex items-center gap-2 px-2 pb-2.5 mb-2.5 border-b border-slate-200">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: SC[stage].c }} />
                      <span className="text-[12px] font-bold text-slate-800 flex-1">{stage}</span>
                      <span className="text-[11px] font-bold bg-white rounded px-1.5 py-0.5 text-slate-500">{sb.length}</span>
                    </div>
                    {sb.map(b => (
                      <div key={b.id} onClick={() => setSel(b)} className="pipe-card bg-white rounded-lg p-3 mb-2 cursor-pointer transition-shadow" style={{ borderLeft: '3px solid ' + SC[stage].c }}>
                        <div className="text-[12px] font-bold text-slate-800 mb-1">{b.name}</div>
                        <div className="text-[11px] text-slate-500 mb-1.5">{b.client}</div>
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span style={{ color: du(b.due) >= 0 && du(b.due) <= 3 ? '#DC2626' : '#64748B' }}>Due {fs(b.due)}</span>
                          <span className="bg-slate-100 px-1.5 rounded font-semibold">{b.owner}</span>
                        </div>
                      </div>
                    ))}
                    {sb.length === 0 && <div className="text-center text-slate-300 text-[12px] py-5">No bids</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── ALL BIDS ── */}
          {view === 'bids' && (
            <div className="bg-white rounded-xl border border-slate-100">
              <div className="flex gap-1.5 flex-wrap px-4 py-3 border-b border-slate-100">
                {['all', ...ALL_S].map(s => (
                  <button key={s} onClick={() => setFilter(s)} className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${filter === s ? 'bg-navy-500 text-white' : 'border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    {s === 'all' ? 'All' : s}
                  </button>
                ))}
              </div>
              <BidTable bids={filtered} onSelect={setSel} />
              {filtered.length === 0 && <div className="p-8 text-center text-slate-400 text-[13px]">No bids found.</div>}
            </div>
          )}

          {/* ── COMMBUYS FEED ── */}
          {view === 'commbuys' && <CommBuysFeed />}

          {/* ── CALENDAR ── */}
          {view === 'calendar' && (
            <div className="bg-white rounded-xl border border-slate-100">
              <div className="flex items-center justify-center gap-5 px-4 py-3.5">
                <button onClick={() => setCalMo(new Date(calMo.getFullYear(), calMo.getMonth() - 1, 1))} className="border border-slate-200 rounded-lg px-3 py-1 text-lg cursor-pointer text-slate-600 hover:bg-slate-50">&lt;</button>
                <h3 className="text-[17px] font-extrabold text-slate-900 min-w-[170px] text-center">{calLabel}</h3>
                <button onClick={() => setCalMo(new Date(calMo.getFullYear(), calMo.getMonth() + 1, 1))} className="border border-slate-200 rounded-lg px-3 py-1 text-lg cursor-pointer text-slate-600 hover:bg-slate-50">&gt;</button>
              </div>
              <div className="grid grid-cols-7 border-b border-slate-100">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="text-center py-2 text-[11px] font-bold text-slate-400">{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({ length: startDay }, (_, i) => <div key={'e' + i} className="min-h-[90px] border border-slate-100 p-1" />)}
                {Array.from({ length: dim }, (_, i) => {
                  const day = i + 1;
                  const db = bidsForDay(day);
                  const isT = today.getDate() === day && today.getMonth() === calMo.getMonth() && today.getFullYear() === calMo.getFullYear();
                  return (
                    <div key={day} className={`min-h-[90px] border border-slate-100 p-1.5 ${isT ? 'bg-blue-50' : db.length ? 'bg-slate-50/50' : ''}`}>
                      <div className={`text-[12px] font-semibold mb-1 ${isT ? 'bg-navy-500 text-white rounded-full w-6 h-6 flex items-center justify-center' : 'text-slate-600'}`}>{day}</div>
                      {db.slice(0, 2).map(b => (
                        <div key={b.id} onClick={() => setSel(b)} className="text-[10px] px-1 py-0.5 bg-blue-50 rounded mb-0.5 cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis text-navy-500 font-medium" style={{ borderLeft: '2px solid ' + (SC[b.status]?.c || '#3B82F6') }}>
                          {b.name.length > 18 ? b.name.substring(0, 18) + '...' : b.name}
                        </div>
                      ))}
                      {db.length > 2 && <div className="text-[10px] text-slate-400">+{db.length - 2} more</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── DETAIL PANEL ── */}
      {sel && (
        <div className="fixed inset-0 bg-slate-900/40 flex justify-end z-50" onClick={() => setSel(null)}>
          <div className="w-[420px] bg-white h-full overflow-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between p-5 border-b border-slate-100">
              <div>
                <div className="font-mono text-[12px] text-slate-400 mb-1">{sel.id}</div>
                <h2 className="text-[17px] font-extrabold text-slate-900 mb-1">{sel.name}</h2>
                <div className="text-[14px] text-slate-500">{sel.client}</div>
              </div>
              <button onClick={() => setSel(null)} className="bg-slate-100 rounded-lg w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-200 shrink-0">X</button>
            </div>
            <div className="p-5">
              <Badge status={sel.status} />
              <div className="mt-4 space-y-0">
                {[['Due Date', fd(sel.due)], ['Owner', sel.owner], sel.walk ? ['Walkthrough', fdt(sel.walk)] : null, sel.walkLoc ? ['Location', sel.walkLoc] : null].filter(Boolean).map(([l, v]) => (
                  <div key={l} className="flex justify-between py-2.5 border-b border-slate-50">
                    <span className="text-[13px] text-slate-400">{l}</span>
                    <span className="text-[13px] text-slate-800 font-semibold">{v}</span>
                  </div>
                ))}
              </div>
              {sel.notes && <div className="mt-4 p-3.5 bg-slate-50 rounded-lg"><div className="text-[11px] font-bold text-slate-400 tracking-wider mb-1.5">NOTES</div><div className="text-[13px] text-slate-600 leading-relaxed">{sel.notes}</div></div>}
              <div className="mt-5 grid grid-cols-2 gap-2">
                {sel.driveFolderUrl && <a href={sel.driveFolderUrl} target="_blank" rel="noreferrer" className="block text-center py-2.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">Open Folder</a>}
                {sel.rfpUrl && <a href={sel.rfpUrl} target="_blank" rel="noreferrer" className="block text-center py-2.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">View RFP</a>}
                {sel.draftUrl && <a href={sel.draftUrl} target="_blank" rel="noreferrer" className="block text-center py-2.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">Open Draft</a>}
                {sel.status !== 'Submitted' && sel.status !== 'Won' && sel.status !== 'Lost' && (
                  <button onClick={() => handleStatusUpdate(sel.id, 'Submitted')} className="py-2.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700">Mark Submitted</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── NEW BID FORM ── */}
      {showForm && <NewBidModal onClose={() => setShowForm(false)} onSave={handleAddBid} userEmail={session?.user?.email || ''} />}
    </div>
  );
}

// ─── Bid Table ───
function BidTable({ bids, onSelect }) {
  if (!bids.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead><tr>{['ID', 'Name', 'Client', 'Due', 'Owner', 'Status'].map(h => <th key={h} className="text-left px-3.5 py-2.5 text-[11px] font-bold text-slate-500 tracking-wide border-b border-slate-100 bg-slate-50/50">{h}</th>)}</tr></thead>
        <tbody>{bids.map(b => {
          const d = du(b.due);
          return (
            <tr key={b.id} onClick={() => onSelect(b)} className="bid-row cursor-pointer border-b border-slate-50">
              <td className="px-3.5 py-2.5 font-mono text-[12px] text-slate-400">{b.id}</td>
              <td className="px-3.5 py-2.5 text-[13px] font-semibold text-slate-800">{b.name}</td>
              <td className="px-3.5 py-2.5 text-[13px] text-slate-600">{b.client}</td>
              <td className="px-3.5 py-2.5 text-[13px]" style={{ color: d >= 0 && d <= 3 ? '#DC2626' : d >= 0 && d <= 7 ? '#D97706' : '#64748B' }}>{fd(b.due)}{d >= 0 && d <= 7 ? ` (${d}d)` : ''}</td>
              <td className="px-3.5 py-2.5 text-[13px] text-slate-600">{b.owner}</td>
              <td className="px-3.5 py-2.5"><Badge status={b.status} /></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

// ─── New Bid Modal ───
function NewBidModal({ onClose, onSave, userEmail }) {
  const [f, setF] = useState({ name: '', client: '', due: '', walk: '', walkLoc: '', owner: 'Craig', ownerEmail: userEmail, notes: '' });
  const [saving, setSaving] = useState(false);
  const up = (k, v) => setF(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!f.name) return;
    setSaving(true);
    await onSave(f);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex justify-end z-50" onClick={onClose}>
      <div className="w-[480px] bg-white h-full overflow-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-6 py-5 border-b border-slate-100">
          <h2 className="text-[18px] font-extrabold text-slate-900">Add New Bid</h2>
          <button onClick={onClose} className="bg-slate-100 rounded-lg w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-200">X</button>
        </div>
        <div className="px-6 py-5">
          <div className="grid grid-cols-2 gap-3.5 mb-3.5">
            {[['Bid Name *', 'name', 'text', 'e.g. Custodial Services'], ['Client', 'client', 'text', 'e.g. Town of Weymouth'], ['Due Date', 'due', 'date', ''], ['Owner', 'owner', 'select', ''], ['Walk Date', 'walk', 'datetime-local', ''], ['Walk Location', 'walkLoc', 'text', 'Address']].map(([label, key, type, ph]) => (
              <div key={key}>
                <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">{label}</label>
                {type === 'select' ? (
                  <select value={f[key]} onChange={e => up(key, e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[13px] text-slate-700 outline-none bg-slate-50">
                    <option>Craig</option><option>Craig Jr.</option>
                  </select>
                ) : (
                  <input type={type} placeholder={ph} value={f[key]} onChange={e => up(key, e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[13px] text-slate-700 outline-none bg-slate-50" />
                )}
              </div>
            ))}
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Notes</label>
            <textarea placeholder="Notes..." value={f.notes} onChange={e => up('notes', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[13px] text-slate-700 outline-none bg-slate-50 min-h-[80px] resize-y" />
          </div>
          <div className="flex gap-2.5 justify-end mt-5">
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-500 text-[13px] font-semibold hover:bg-slate-50">Cancel</button>
            <button onClick={handleSubmit} disabled={saving || !f.name} className="px-4 py-2.5 rounded-lg bg-navy-500 text-white text-[13px] font-bold hover:bg-navy-600 disabled:opacity-50">
              {saving ? 'Adding...' : 'Add Bid'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page wrapper with AuthProvider ───
export default function Page() {
  return (
    <AuthProvider>
      <BidCenter />
    </AuthProvider>
  );
}
