
import React, { useState, useEffect, useRef } from 'react';
import type { Student } from '../types';
import QRCode from 'qrcode';
import { DownloadIcon } from './icons/DownloadIcon';
import { EyeIcon } from './icons/EyeIcon';
import { EyeSlashIcon } from './icons/EyeSlashIcon';
import { UserIcon } from './icons/UserIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { ClockIcon } from './icons/ClockIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { GoogleSheetIntegrationInfo } from './GoogleSheetIntegrationInfo';
import { PRE_REGISTERED_STUDENTS } from '../studentList';

interface TeacherViewProps {
  attendanceList: Student[];
  onTestAttendance: () => void;
  onClearAttendance: () => void;
  onRemoveStudents: (studentIds: string[]) => void;
  onBulkStatusUpdate: (studentIds: string[], status: 'P' | 'A') => void;
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onOpenKiosk: () => void;
  onManualAdd: (name: string, id: string, email: string, status: 'P' | 'A') => {success: boolean, message: string};
  pendingSyncCount?: number;
}

type SortOption = 'id' | 'newest' | 'oldest';

interface TestStats {
    total: number;
    success: number;
    retrying: number;
    failed: number;
    isRunning: boolean;
}

export const TeacherView: React.FC<TeacherViewProps> = ({ 
  attendanceList, 
  onTestAttendance, 
  onClearAttendance, 
  onRemoveStudents,
  onBulkStatusUpdate,
  scriptUrl, 
  onScriptUrlChange, 
  onOpenKiosk, 
  onManualAdd,
  pendingSyncCount = 0
}) => {
  const [baseUrl, setBaseUrl] = useState<string>(window.location.href.split('?')[0]);
  const [qrData, setQrData] = useState<string>('');
  
  const [showEmailSetup, setShowEmailSetup] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom'>('teacher');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  
  // Filter State
  const [timeFilter, setTimeFilter] = useState<'all' | number>('all');
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Manual Entry State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualStatus, setManualStatus] = useState<'P' | 'A'>('P');
  const [manualError, setManualError] = useState('');
  const [manualIsNew, setManualIsNew] = useState(false);

  // Stress Test State
  const [testStats, setTestStats] = useState<TestStats>({ total: 0, success: 0, retrying: 0, failed: 0, isRunning: false });

  // QR Loading State
  const [isQrLoading, setIsQrLoading] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    const updateQR = () => {
        let cleanBaseUrl = baseUrl.trim();
        const timestamp = Date.now().toString();
        const separator = cleanBaseUrl.includes('?') ? '&' : '?';
        const fullUrl = `${cleanBaseUrl}${separator}t=${timestamp}`;
        setQrData(fullUrl);
    };

    updateQR();
    const interval = setInterval(updateQR, 1000);
    return () => clearInterval(interval);
  }, [baseUrl]);

  useEffect(() => {
    if (canvasRef.current && qrData) {
      QRCode.toCanvas(canvasRef.current, qrData, { 
          width: 600, 
          color: { dark: '#000000', light: '#ffffff' },
          margin: 2
        }, (error) => {
        setIsQrLoading(false);
        if (error) console.error(error);
      });
    }
  }, [qrData]);

  useEffect(() => {
    if (timeFilter === 'all') return;
    const interval = setInterval(() => setCurrentTime(Date.now()), 10000);
    return () => clearInterval(interval);
  }, [timeFilter]);

  const sortList = (list: Student[]) => {
    const sorted = [...list];
    switch (sortBy) {
      case 'id': return sorted.sort((a, b) => a.studentId.localeCompare(b.studentId, undefined, { numeric: true }));
      case 'newest': return sorted.sort((a, b) => b.timestamp - a.timestamp);
      case 'oldest': return sorted.sort((a, b) => a.timestamp - b.timestamp);
      default: return sorted;
    }
  };

  const visibleList = sortList(timeFilter === 'all' ? attendanceList : attendanceList.filter(s => s.timestamp >= (currentTime - (timeFilter * 60 * 1000))));

  const handleExportCSV = () => {
    if (attendanceList.length === 0) return;
    const headers = ['Timestamp', 'Student Name', 'Student ID', 'Email', 'Status'];
    const dataToExport = sortList(attendanceList);
    const csvContent = [headers.join(','), ...dataToExport.map(student => [new Date(student.timestamp).toLocaleString(), `"${student.name}"`, `"${student.studentId}"`, `"${student.email}"`, student.status].join(','))].join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handleBulkRemove = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`Are you sure you want to remove the ${selectedIds.size} selected students?`)) {
      onRemoveStudents(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  const handleBulkStatusChange = (status: 'P' | 'A') => {
    if (selectedIds.size === 0) return;
    const statusLabel = status === 'P' ? 'Present' : 'Absent';
    if (window.confirm(`Mark ${selectedIds.size} selected students as ${statusLabel}?`)) {
      onBulkStatusUpdate(Array.from(selectedIds), status);
      setSelectedIds(new Set());
    }
  };

  // --- STRESS TEST LOGIC ---
  const runStressTest = async () => {
    if (!scriptUrl || !scriptUrl.startsWith('http')) { alert("Set a valid Script URL first."); return; }
    if (!window.confirm("Simulating 230 students.\n\nNOTE: To prevent Google Server Errors (Lock Timeout), we will simulate a realistic queue of students.\n\nThis will take about 3 minutes. Please do not close the tab.")) return;

    setTestStats({ total: 230, success: 0, retrying: 0, failed: 0, isRunning: true });
    
    // Prepare 230 test subjects
    const testPool = [...PRE_REGISTERED_STUDENTS];
    // Ensure we have at least 230 items
    while(testPool.length < 230) {
        testPool.push({ id: `STRESS-${testPool.length + 1}-${Date.now()}`, name: `STRESS TESTER ${testPool.length + 1}` });
    }
    const finalPool = testPool.slice(0, 230);

    // Track completion to turn off the spinner
    let completedCount = 0;
    const checkCompletion = () => {
        completedCount++;
        if (completedCount >= finalPool.length && isMountedRef.current) {
            setTestStats(prev => ({ ...prev, isRunning: false }));
            console.log("Stress Test Completed");
        }
    };

    // OPTIMIZED FOR 100% SUCCESS RATE
    // Google Sheets LockService waits 30s. Writing takes ~1.5s.
    // 30s / 1.5s = ~20 requests max queue depth.
    // By sending 3 requests every 2 seconds (1.5 req/s), we match the write speed.
    const CHUNK_SIZE = 3; 
    const DELAY_MS = 2000; 

    console.log(`Starting stress test: ${finalPool.length} students, chunk size ${CHUNK_SIZE}, delay ${DELAY_MS}ms`);

    for (let i = 0; i < finalPool.length; i += CHUNK_SIZE) {
        const chunk = finalPool.slice(i, i + CHUNK_SIZE);
        
        chunk.forEach((student) => {
            const attemptSync = async (retries = 0) => {
                try {
                    const formData = new URLSearchParams();
                    formData.append('studentId', student.id);
                    formData.append('name', student.name);
                    formData.append('email', `${student.id}@student.uts.edu.my`);
                    formData.append('status', 'P');

                    // Add cache busting and random param to avoid browser aggressive caching/batching
                    const uniqueUrl = `${scriptUrl}${scriptUrl.includes('?') ? '&' : '?'}cb=${Date.now()}-${Math.random()}`;

                    const response = await fetch(uniqueUrl, {
                        method: 'POST',
                        body: formData,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    });

                    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
                    
                    const text = await response.text();
                    let res;
                    try {
                        res = JSON.parse(text);
                    } catch {
                        throw new Error("Invalid Server Response");
                    }

                    if (res.result !== 'success') throw new Error(res.message || "Script Rejected");

                    if (isMountedRef.current) {
                        setTestStats(prev => ({ 
                            ...prev, 
                            success: prev.success + 1, 
                            retrying: Math.max(0, prev.retrying - (retries > 0 ? 1 : 0)) 
                        }));
                    }
                    checkCompletion();
                } catch (err) {
                    console.warn(`Failed ${student.id} retry ${retries}:`, err);
                    if (retries < 4) {
                        if (isMountedRef.current) {
                            setTestStats(prev => ({ ...prev, retrying: prev.retrying + (retries === 0 ? 1 : 0) }));
                        }
                        // Jitter to spread out retry load
                        const jitter = 3000 + Math.random() * 4000; 
                        setTimeout(() => attemptSync(retries + 1), jitter);
                    } else {
                        if (isMountedRef.current) {
                            setTestStats(prev => ({ 
                                ...prev, 
                                failed: prev.failed + 1, 
                                retrying: Math.max(0, prev.retrying - 1) 
                            }));
                        }
                        checkCompletion();
                    }
                }
            };
            attemptSync();
        });

        // Delay between chunks to allow browser event loop to breathe and network request dispatch
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  };

  return (
    <div className="w-full relative">
       <div className="absolute -top-12 right-0">
         <button onClick={() => setViewMode(viewMode === 'teacher' ? 'classroom' : 'teacher')} className="p-2 rounded-full bg-base-100 hover:bg-base-300 text-gray-600 transition-colors">
            {viewMode === 'teacher' ? <EyeIcon className="w-6 h-6" /> : <EyeSlashIcon className="w-6 h-6" />}
         </button>
       </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="w-full lg:w-[40%] order-2 lg:order-1">
          <div className="flex flex-col gap-3 mb-4">
             <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold text-brand-primary">Attendance History</h2>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-white border border-gray-300 rounded px-2 py-1 shadow-sm">
                        <ClockIcon className="w-3 h-3 text-gray-500" />
                        <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="text-xs bg-transparent text-gray-700 border-none">
                            <option value="all">Show All</option>
                            <option value="5">Last 5 Mins</option>
                            <option value="30">Last 30 Mins</option>
                        </select>
                    </div>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="text-xs border border-gray-300 rounded px-2 py-1 bg-white">
                        <option value="newest">Newest</option>
                        <option value="id">ID</option>
                    </select>
                </div>
             </div>

            <div className="flex items-center flex-wrap gap-2 py-1">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary/10 text-brand-primary rounded-full text-xs font-bold border border-brand-primary/20 shadow-sm transition-all">
                    <UserIcon className="w-3.5 h-3.5" />
                    <span>{attendanceList.length} Unique Scans</span>
                </div>
                {pendingSyncCount > 0 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold border border-blue-200 shadow-sm animate-pulse transition-all">
                        <GlobeIcon className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '3s' }} />
                        <span>{pendingSyncCount} Syncing...</span>
                    </div>
                )}
            </div>
            
            {viewMode === 'teacher' && (
                <div className="flex flex-col gap-2">
                     <div className="flex gap-2">
                        <button onClick={() => setShowManualModal(true)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-brand-primary text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-brand-secondary transition-colors"><PencilSquareIcon className="w-4 h-4" />Add Student</button>
                        <button onClick={onOpenKiosk} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg shadow-sm hover:bg-blue-200 transition-colors"><ShieldCheckIcon className="w-4 h-4" />Admin Mode</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {selectedIds.size > 0 ? (
                            <div className="flex-1 flex flex-wrap gap-2">
                                <button onClick={() => handleBulkStatusChange('P')} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-green-700 transition-colors">
                                    <CheckCircleIcon className="w-4 h-4" />Present
                                </button>
                                <button onClick={() => handleBulkStatusChange('A')} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-orange-500 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-orange-600 transition-colors">
                                    <XCircleIcon className="w-4 h-4" />Absent
                                </button>
                                <button onClick={handleBulkRemove} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-red-700 transition-colors">
                                    <TrashIcon className="w-4 h-4" />Remove
                                </button>
                            </div>
                        ) : (
                            <button onClick={onClearAttendance} disabled={attendanceList.length === 0} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-100 text-red-700 text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"><TrashIcon className="w-4 h-4" />Clear View</button>
                        )}
                        <button onClick={handleExportCSV} disabled={attendanceList.length === 0} className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-brand-secondary text-white text-xs font-semibold rounded-lg shadow-md transition-colors ${selectedIds.size > 0 ? 'hidden sm:flex' : ''}`}><DownloadIcon className="w-4 h-4" />Export CSV</button>
                    </div>
                </div>
            )}
          </div>
          
          <div className="bg-base-100 rounded-lg p-2 max-h-[600px] overflow-y-auto shadow-sm border border-base-300">
            {visibleList.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No records to display.</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-700">
                  <thead className="text-xs text-gray-500 uppercase bg-base-200 sticky top-0">
                    <tr>
                      {viewMode === 'teacher' && <th className="px-4 py-3 w-4"><input type="checkbox" checked={visibleList.length > 0 && visibleList.every(s => selectedIds.has(s.studentId))} onChange={() => { if(selectedIds.size === visibleList.length) setSelectedIds(new Set()); else setSelectedIds(new Set(visibleList.map(s => s.studentId))); }} /></th>}
                      <th className="px-4 py-3">Student ID</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleList.map((student) => (
                      <tr key={`${student.studentId}-${student.timestamp}`} className={`border-b border-base-200 hover:bg-base-300 ${selectedIds.has(student.studentId) ? 'bg-indigo-50' : ''}`}>
                        {viewMode === 'teacher' && <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.has(student.studentId)} onChange={() => { const next = new Set(selectedIds); if(next.has(student.studentId)) next.delete(student.studentId); else next.add(student.studentId); setSelectedIds(next); }} /></td>}
                        <td className="px-4 py-3 font-mono font-bold">{student.studentId}</td>
                        <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${student.status === 'P' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {student.status === 'P' ? 'Present' : 'Absent'}
                            </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">{new Date(student.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="w-full lg:flex-1 flex flex-col items-center bg-base-100 p-6 rounded-lg shadow-md order-1 lg:order-2">
          {viewMode === 'teacher' && (
              <div className="w-full space-y-4 mb-4">
                  <button onClick={() => setShowEmailSetup(!showEmailSetup)} className="text-sm text-brand-primary underline hover:text-brand-secondary font-medium">
                    {showEmailSetup ? 'Hide Cloud Configuration' : 'Configure Cloud Recording & Stress Test'}
                  </button>
                  
                  {showEmailSetup && (
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
                      <GoogleSheetIntegrationInfo />
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Google Web App URL</label>
                          <input type="text" value={scriptUrl} onChange={(e) => onScriptUrlChange(e.target.value)} className="block w-full bg-white border border-gray-300 rounded-md py-2 px-3 text-sm text-gray-600" />
                      </div>
                      
                      {/* STRESS TEST BOX */}
                      <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="text-sm font-bold text-orange-800">Concurrency Stress Test</h4>
                            {!testStats.isRunning ? (
                                <button onClick={runStressTest} className="px-3 py-1 bg-orange-600 text-white text-xs font-bold rounded-full hover:bg-orange-700">Simulate 230 Scans</button>
                            ) : (
                                <span className="text-xs font-bold text-orange-600 animate-pulse">Running Test...</span>
                            )}
                        </div>
                        {(testStats.isRunning || testStats.total > 0) && (
                            <div className="space-y-2">
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div className={`h-2 rounded-full transition-all duration-500 ${testStats.failed > 0 && !testStats.isRunning ? 'bg-orange-500' : 'bg-green-500'}`} style={{ width: `${((testStats.success + testStats.failed) / (testStats.total || 1)) * 100}%` }}></div>
                                </div>
                                <div className="flex justify-between text-[10px] font-bold uppercase">
                                    <span className="text-green-600">Success: {testStats.success}</span>
                                    <span className="text-blue-600">Retrying: {testStats.retrying}</span>
                                    <span className="text-red-600">Failed: {testStats.failed}</span>
                                    <span className="text-gray-500">Left: {Math.max(0, testStats.total - testStats.success - testStats.failed)}</span>
                                </div>
                                {!testStats.isRunning && testStats.total > 0 && (
                                  <p className="text-[10px] font-bold text-center mt-1">
                                    {testStats.success === testStats.total 
                                      ? <span className="text-green-700">✓ ALL 230 SCANS SAVED SUCCESSFULLY!</span> 
                                      : <span className="text-orange-700">⚠ TEST COMPLETED WITH {testStats.failed} FAILURES</span>}
                                  </p>
                                )}
                            </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
          )}

          <h2 className="text-2xl font-bold mb-4 text-brand-primary">Scan to Check-in</h2>
          <div className="bg-white p-4 rounded-lg shadow-inner border border-gray-200 relative min-h-[300px] flex items-center justify-center">
             {isQrLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 rounded-lg">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mb-2"></div>
                    <p className="text-sm text-gray-500">Generating Secure QR...</p>
                </div>
             )}
            <canvas ref={canvasRef} className="rounded-md w-full h-auto block" />
          </div>
          <p className="text-gray-500 text-sm mt-4 text-center">Refreshes every second for high security.</p>
        </div>
      </div>

      {showManualModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h3 className="text-lg font-bold text-gray-900">Add Student</h3>
                    <button onClick={() => setShowManualModal(false)} className="text-gray-400 hover:text-gray-500 font-bold text-xl">&times;</button>
                </div>
                <form onSubmit={(e) => {
                    e.preventDefault();
                    const res = onManualAdd(manualName, manualId, `${manualId}@student.uts.edu.my`, manualStatus);
                    if(res.success) { setShowManualModal(false); setManualId(''); setManualName(''); }
                    else { setManualError(res.message); }
                }} className="p-6 space-y-4">
                    <input type="text" value={manualId} onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setManualId(val);
                        const matched = PRE_REGISTERED_STUDENTS.find(s => s.id === val);
                        if(matched) { setManualName(matched.name); setManualIsNew(false); }
                        else { setManualIsNew(true); }
                    }} placeholder="Student ID (FIA...)" className="block w-full border border-gray-300 rounded-md p-2 uppercase" />
                    <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value.toUpperCase())} readOnly={!manualIsNew && manualName.length > 0} placeholder="Full Name" className={`block w-full border border-gray-300 rounded-md p-2 uppercase ${!manualIsNew && manualName.length > 0 ? 'bg-gray-100' : ''}`} />
                    <div className="flex gap-4">
                        <label className="flex items-center text-sm"><input type="radio" checked={manualStatus === 'P'} onChange={() => setManualStatus('P')} className="mr-2"/>Present</label>
                        <label className="flex items-center text-sm"><input type="radio" checked={manualStatus === 'A'} onChange={() => setManualStatus('A')} className="mr-2"/>Absent</label>
                    </div>
                    {manualError && <p className="text-xs text-red-600">{manualError}</p>}
                    <button type="submit" className="w-full py-2 bg-brand-primary text-white rounded font-bold">Confirm Add</button>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};
